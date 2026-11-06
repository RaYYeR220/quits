/// Quits settlement rails.
///
/// A member who wants their share of a group tab paid automatically signs ONE
/// transaction that (1) proposes a Sui `Allowance` bound to this app, and
/// (2) opens a `Mandate` naming the only people the money may ever go to.
///
/// From then on the Quits settlement agent can pull money from that member's
/// address balance, but only through `settle`, and `settle` only moves:
///   * the exact amount of a debt the registrar recorded on-chain,
///   * to a creditor the member listed in their mandate,
///   * once per debt,
///   * after the member's objection window has passed,
///   * within the allowance's own cap / rate limit / expiry (enforced by `sui::allowance`).
///
/// The member can object to (cancel) any debt before it is pulled, close the
/// mandate, or revoke the allowance with their `AllowanceCap` at any time.
module quits::settle;

use std::internal;
use std::string::String;
use sui::allowance::{Self, Allowance, AllowanceProposal, AllowanceWithdrawal};
use sui::balance::Balance;
use sui::clock::Clock;
use sui::event;
use sui::vec_set::{Self, VecSet};

// === Errors ===

#[error]
const ENotFunder: vector<u8> = b"Only the allowance funder can open this mandate";
#[error]
const EWrongSpender: vector<u8> = b"The allowance must name the Quits settlement agent as spender";
#[error]
const ENoCreditors: vector<u8> = b"A mandate needs at least one creditor";
#[error]
const ESelfCreditor: vector<u8> = b"The funder cannot be their own creditor";
#[error]
const ENotRegistrar: vector<u8> = b"Only the Quits registrar can record debts";
#[error]
const EPaused: vector<u8> = b"Settlement is paused";
#[error]
const EUnknownCreditor: vector<u8> = b"Creditor is not listed in the mandate";
#[error]
const EOverDebtLimit: vector<u8> = b"Debt exceeds the mandate's per-debt limit";
#[error]
const EZeroAmount: vector<u8> = b"Debt amount must be positive";
#[error]
const ENotOpen: vector<u8> = b"Debt is not open";
#[error]
const EWrongMandate: vector<u8> = b"Debt does not belong to this mandate";
#[error]
const EWrongAllowance: vector<u8> = b"Allowance does not belong to this mandate";
#[error]
const EInObjectionWindow: vector<u8> = b"The debtor's objection window has not passed yet";
#[error]
const EAmountMismatch: vector<u8> = b"Withdrawal must equal the debt amount exactly";
#[error]
const ENotAllowedToCancel: vector<u8> = b"Only the debtor or the registrar can cancel a debt";
#[error]
const EMandateNameMismatch: vector<u8> = b"Allowance name must equal the mandate group";

// === Debt status ===

const STATUS_OPEN: u8 = 0;
const STATUS_SETTLED_BY_ALLOWANCE: u8 = 1;
const STATUS_SETTLED_EXTERNALLY: u8 = 2;
const STATUS_CANCELLED: u8 = 3;

// === Objects ===

/// App witness. Allowances bound to `APP` can only be spent through this module.
public struct APP() has drop;

/// Held by the Quits operator; changes roles and pauses settlement.
public struct AdminCap has key, store {
    id: UID,
}

/// Shared configuration.
public struct Config has key {
    id: UID,
    /// Address allowed to record debts on-chain.
    registrar: address,
    /// The only spender this app accepts on allowances.
    agent: address,
    paused: bool,
}

/// A member's standing instruction for one group.
public struct Mandate has key {
    id: UID,
    funder: address,
    /// Group label; the bound allowance must carry the same name.
    group: String,
    /// The only addresses money may be sent to.
    creditors: VecSet<address>,
    /// Upper bound for any single debt, in the coin's base units.
    max_per_debt: u64,
    /// How long a newly recorded debt waits before it can be pulled.
    objection_window_ms: u64,
}

/// One debt between two members, recorded so the agent can settle it.
public struct Debt<phantom C> has key {
    id: UID,
    mandate: ID,
    group: String,
    /// Off-chain reference (Quits debt id).
    reference: String,
    debtor: address,
    creditor: address,
    amount: u64,
    recorded_at_ms: u64,
    status: u8,
}

// === Events ===

public struct MandateOpened has copy, drop {
    mandate: ID,
    funder: address,
    group: String,
    creditors: vector<address>,
    max_per_debt: u64,
    objection_window_ms: u64,
}

public struct MandateClosed has copy, drop {
    mandate: ID,
    funder: address,
}

public struct DebtRecorded has copy, drop {
    debt: ID,
    mandate: ID,
    reference: String,
    debtor: address,
    creditor: address,
    amount: u64,
    pullable_at_ms: u64,
}

public struct DebtSettled has copy, drop {
    debt: ID,
    reference: String,
    debtor: address,
    creditor: address,
    amount: u64,
    status: u8,
}

public struct DebtCancelled has copy, drop {
    debt: ID,
    reference: String,
    by: address,
}

// === Init ===

fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Config {
        id: object::new(ctx),
        registrar: ctx.sender(),
        agent: ctx.sender(),
        paused: false,
    });
}

// === Admin ===

public fun set_roles(_: &AdminCap, config: &mut Config, registrar: address, agent: address) {
    config.registrar = registrar;
    config.agent = agent;
}

public fun set_paused(_: &AdminCap, config: &mut Config, paused: bool) {
    config.paused = paused;
}

// === Mandates ===

/// Called by the funder in the same PTB as `sui::allowance::propose_for_app<Balance<C>, APP>`.
/// Issues the allowance on this app's behalf and opens the matching mandate.
public fun open_mandate<C>(
    config: &Config,
    proposal: AllowanceProposal<Balance<C>>,
    creditors: vector<address>,
    max_per_debt: u64,
    objection_window_ms: u64,
    ctx: &mut TxContext,
) {
    let settings = proposal.settings();
    let funder = settings.funder();
    assert!(funder == ctx.sender(), ENotFunder);
    assert!(settings.spender().contains(&config.agent), EWrongSpender);
    assert!(!creditors.is_empty(), ENoCreditors);
    assert!(!creditors.contains(&funder), ESelfCreditor);
    assert!(max_per_debt > 0, EZeroAmount);
    let group = *settings.name();

    allowance::issue<Balance<C>, APP>(
        proposal,
        allowance::settings_permit(internal::permit<APP>()),
        ctx,
    );

    let mandate = Mandate {
        id: object::new(ctx),
        funder,
        group,
        creditors: vec_set::from_keys(creditors),
        max_per_debt,
        objection_window_ms,
    };
    event::emit(MandateOpened {
        mandate: object::id(&mandate),
        funder,
        group: mandate.group,
        creditors: *mandate.creditors.keys(),
        max_per_debt,
        objection_window_ms,
    });
    transfer::share_object(mandate);
}

/// The funder closes their mandate. Debts that point at it can no longer be pulled.
/// (The allowance itself is revoked separately with the funder's `AllowanceCap`.)
public fun close_mandate(mandate: Mandate, ctx: &TxContext) {
    assert!(mandate.funder == ctx.sender(), ENotFunder);
    let Mandate { id, funder, .. } = mandate;
    event::emit(MandateClosed { mandate: id.to_inner(), funder });
    id.delete();
}

// === Debts ===

/// The registrar records a debt that the debtor's mandate covers.
public fun record_debt<C>(
    config: &Config,
    mandate: &Mandate,
    reference: String,
    creditor: address,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == config.registrar, ENotRegistrar);
    assert!(!config.paused, EPaused);
    assert!(amount > 0, EZeroAmount);
    assert!(amount <= mandate.max_per_debt, EOverDebtLimit);
    assert!(mandate.creditors.contains(&creditor), EUnknownCreditor);

    let now = clock.timestamp_ms();
    let debt = Debt<C> {
        id: object::new(ctx),
        mandate: object::id(mandate),
        group: mandate.group,
        reference,
        debtor: mandate.funder,
        creditor,
        amount,
        recorded_at_ms: now,
        status: STATUS_OPEN,
    };
    event::emit(DebtRecorded {
        debt: object::id(&debt),
        mandate: object::id(mandate),
        reference: debt.reference,
        debtor: debt.debtor,
        creditor,
        amount,
        pullable_at_ms: now + mandate.objection_window_ms,
    });
    transfer::share_object(debt);
}

/// The settlement agent pulls exactly the debt amount from the debtor's allowance
/// and sends it to the creditor. `sui::allowance` additionally enforces that the
/// sender is the allowance's spender and that the cap, rate limit and expiry hold.
public fun settle<C>(
    config: &Config,
    mandate: &Mandate,
    debt: &mut Debt<C>,
    alw: &mut Allowance<Balance<C>>,
    withdrawal: AllowanceWithdrawal<Balance<C>>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!config.paused, EPaused);
    assert!(debt.status == STATUS_OPEN, ENotOpen);
    assert!(debt.mandate == object::id(mandate), EWrongMandate);
    assert!(mandate.creditors.contains(&debt.creditor), EUnknownCreditor);
    assert!(
        clock.timestamp_ms() >= debt.recorded_at_ms + mandate.objection_window_ms,
        EInObjectionWindow,
    );
    let settings = alw.settings();
    assert!(settings.funder() == mandate.funder, EWrongAllowance);
    assert!(*settings.name() == mandate.group, EMandateNameMismatch);

    let funds = allowance::app_balance_spend<C, APP>(
        alw,
        allowance::spend_permit(internal::permit<APP>()),
        withdrawal,
        clock,
        ctx,
    );
    assert!(funds.value() == debt.amount, EAmountMismatch);
    funds.send_funds(debt.creditor);

    debt.status = STATUS_SETTLED_BY_ALLOWANCE;
    event::emit(DebtSettled {
        debt: object::id(debt),
        reference: debt.reference,
        debtor: debt.debtor,
        creditor: debt.creditor,
        amount: debt.amount,
        status: STATUS_SETTLED_BY_ALLOWANCE,
    });
}

/// The registrar marks a debt as paid outside the allowance (e.g. a direct
/// USDC transfer the Quits watcher matched on-chain). Moves no funds.
public fun mark_settled_externally<C>(config: &Config, debt: &mut Debt<C>, ctx: &TxContext) {
    assert!(ctx.sender() == config.registrar, ENotRegistrar);
    assert!(debt.status == STATUS_OPEN, ENotOpen);
    debt.status = STATUS_SETTLED_EXTERNALLY;
    event::emit(DebtSettled {
        debt: object::id(debt),
        reference: debt.reference,
        debtor: debt.debtor,
        creditor: debt.creditor,
        amount: debt.amount,
        status: STATUS_SETTLED_EXTERNALLY,
    });
}

/// The debtor objects to a debt (or the registrar withdraws it) before it is pulled.
public fun cancel_debt<C>(config: &Config, debt: &mut Debt<C>, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(sender == debt.debtor || sender == config.registrar, ENotAllowedToCancel);
    assert!(debt.status == STATUS_OPEN, ENotOpen);
    debt.status = STATUS_CANCELLED;
    event::emit(DebtCancelled { debt: object::id(debt), reference: debt.reference, by: sender });
}

// === Views ===

public fun debt_status<C>(debt: &Debt<C>): u8 { debt.status }

public fun debt_amount<C>(debt: &Debt<C>): u64 { debt.amount }

public fun debt_parties<C>(debt: &Debt<C>): (address, address) { (debt.debtor, debt.creditor) }

public fun pullable_at_ms<C>(debt: &Debt<C>, mandate: &Mandate): u64 {
    debt.recorded_at_ms + mandate.objection_window_ms
}

public fun mandate_funder(mandate: &Mandate): address { mandate.funder }

public fun mandate_group(mandate: &Mandate): String { mandate.group }

public fun mandate_creditors(mandate: &Mandate): vector<address> { *mandate.creditors.keys() }

public fun status_open(): u8 { STATUS_OPEN }

public fun status_settled_by_allowance(): u8 { STATUS_SETTLED_BY_ALLOWANCE }

public fun status_settled_externally(): u8 { STATUS_SETTLED_EXTERNALLY }

public fun status_cancelled(): u8 { STATUS_CANCELLED }

// === Test-only ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
