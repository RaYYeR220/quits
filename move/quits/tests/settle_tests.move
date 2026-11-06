#[test_only]
#[allow(unused_mut_ref)]
module quits::settle_tests;

use std::string::String;
use sui::allowance::{Self, Allowance};
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};
use quits::settle::{Self, APP, AdminCap, Config, Mandate, Debt};

public struct TEST has store {}

const ADMIN: address = @0xA;
const REGISTRAR: address = @0xB;
const AGENT: address = @0xC;
const ANA: address = @0xD1;
const BEN: address = @0xD2;
const CLARA: address = @0xD3;
const MALLORY: address = @0xE;

const HOUR: u64 = 3_600_000;
const FUNDS: u64 = 1_000_000_000;

// === Harness ===

fun g(name: vector<u8>): String { name.to_string() }

/// Publishes the package, assigns roles and funds Ana.
fun setup(): (Scenario, Clock) {
    let mut sc = ts::begin(ADMIN);
    settle::init_for_testing(sc.ctx());
    let clock = clock::create_for_testing(sc.ctx());
    balance::create_for_testing<TEST>(FUNDS).send_funds(ANA);
    sc.next_tx(ADMIN);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut cfg = sc.take_shared<Config>();
        settle::set_roles(&cap, &mut cfg, REGISTRAR, AGENT);
        ts::return_shared(cfg);
        sc.return_to_sender(cap);
    };
    (sc, clock)
}

/// Ana proposes an app-bound allowance and opens a mandate in one transaction.
fun open(
    sc: &mut Scenario,
    group: vector<u8>,
    spender: address,
    lifetime_cap: u256,
    creditors: vector<address>,
    max_per_debt: u64,
    window_ms: u64,
) {
    sc.next_tx(ANA);
    let cfg = sc.take_shared<Config>();
    let proposal = allowance::propose_for_app<Balance<TEST>, APP>(
        g(group),
        spender,
        option::some(lifetime_cap),
        option::none(),
        option::some(std::u64::max_value!()),
        option::none(),
        sc.ctx(),
    );
    settle::open_mandate<TEST>(&cfg, proposal, creditors, max_per_debt, window_ms, sc.ctx());
    ts::return_shared(cfg);
}

fun record(sc: &mut Scenario, clock: &Clock, sender: address, creditor: address, amount: u64) {
    sc.next_tx(sender);
    let cfg = sc.take_shared<Config>();
    let mandate = sc.take_shared<Mandate>();
    settle::record_debt<TEST>(&cfg, &mandate, g(b"debt-1"), creditor, amount, clock, sc.ctx());
    ts::return_shared(mandate);
    ts::return_shared(cfg);
}

/// The agent (or `sender`) pulls `pull` units against the single open debt.
fun pull(sc: &mut Scenario, clock: &Clock, sender: address, pull: u64) {
    sc.next_tx(sender);
    let cfg = sc.take_shared<Config>();
    let mandate = sc.take_shared<Mandate>();
    let mut debt = sc.take_shared<Debt<TEST>>();
    let mut alw = sc.take_shared<Allowance<Balance<TEST>>>();
    let w = allowance::new_withdrawal_for_testing(
        object::id(&alw),
        ts::withdraw_balance_from_address<TEST>(ANA, pull),
    );
    settle::settle<TEST>(&cfg, &mandate, &mut debt, &mut alw, w, clock, sc.ctx());
    ts::return_shared(alw);
    ts::return_shared(debt);
    ts::return_shared(mandate);
    ts::return_shared(cfg);
}

fun status(sc: &mut Scenario): u8 {
    sc.next_tx(ADMIN);
    let debt = sc.take_shared<Debt<TEST>>();
    let s = settle::debt_status(&debt);
    ts::return_shared(debt);
    s
}

fun finish(sc: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    sc.end();
}

// === Happy path ===

#[test]
fun settles_exact_debt_after_objection_window() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN, CLARA], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    assert!(status(&mut sc) == settle::status_settled_by_allowance());
    finish(sc, clock);
}

#[test]
fun mandate_records_funder_group_and_creditors() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"lisbon", AGENT, 100_000_000, vector[BEN, CLARA], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    let mandate = sc.take_shared<Mandate>();
    assert!(settle::mandate_funder(&mandate) == ANA);
    assert!(settle::mandate_group(&mandate) == g(b"lisbon"));
    assert!(settle::mandate_creditors(&mandate) == vector[BEN, CLARA]);
    ts::return_shared(mandate);
    finish(sc, clock);
}

#[test]
fun registrar_can_mark_external_payment() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 5_000_000);
    sc.next_tx(REGISTRAR);
    {
        let cfg = sc.take_shared<Config>();
        let mut debt = sc.take_shared<Debt<TEST>>();
        settle::mark_settled_externally<TEST>(&cfg, &mut debt, sc.ctx());
        ts::return_shared(debt);
        ts::return_shared(cfg);
    };
    assert!(status(&mut sc) == settle::status_settled_externally());
    finish(sc, clock);
}

// === Mandate guards ===

#[test, expected_failure(abort_code = settle::EWrongSpender)]
fun mandate_rejects_allowance_for_another_spender() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", MALLORY, 100_000_000, vector[BEN], 50_000_000, HOUR);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ESelfCreditor)]
fun mandate_rejects_funder_as_creditor() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[ANA, BEN], 50_000_000, HOUR);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ENoCreditors)]
fun mandate_rejects_empty_creditors() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[], 50_000_000, HOUR);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ENotFunder)]
fun only_funder_closes_mandate() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(MALLORY);
    let mandate = sc.take_shared<Mandate>();
    settle::close_mandate(mandate, sc.ctx());
    finish(sc, clock);
}

// === Recording guards ===

#[test, expected_failure(abort_code = settle::ENotRegistrar)]
fun only_registrar_records_debts() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, MALLORY, BEN, 1_000_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EUnknownCreditor)]
fun debt_to_unlisted_creditor_rejected() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, MALLORY, 1_000_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EOverDebtLimit)]
fun debt_over_per_debt_limit_rejected() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 50_000_001);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EZeroAmount)]
fun zero_debt_rejected() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 0);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EPaused)]
fun paused_blocks_recording() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut cfg = sc.take_shared<Config>();
        settle::set_paused(&cap, &mut cfg, true);
        ts::return_shared(cfg);
        sc.return_to_sender(cap);
    };
    record(&mut sc, &clock, REGISTRAR, BEN, 1_000_000);
    finish(sc, clock);
}

// === Settlement guards ===

#[test, expected_failure(abort_code = settle::EInObjectionWindow)]
fun cannot_pull_inside_objection_window() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR - 1);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EAmountMismatch)]
fun cannot_pull_more_than_the_debt() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 20_000_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EAmountMismatch)]
fun cannot_pull_less_than_the_debt() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_339_999);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ENotOpen)]
fun cannot_pull_twice() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ENotOpen)]
fun debtor_objection_blocks_the_pull() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    sc.next_tx(ANA);
    {
        let cfg = sc.take_shared<Config>();
        let mut debt = sc.take_shared<Debt<TEST>>();
        settle::cancel_debt<TEST>(&cfg, &mut debt, sc.ctx());
        ts::return_shared(debt);
        ts::return_shared(cfg);
    };
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::ENotAllowedToCancel)]
fun stranger_cannot_cancel() {
    let (mut sc, clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    sc.next_tx(MALLORY);
    let cfg = sc.take_shared<Config>();
    let mut debt = sc.take_shared<Debt<TEST>>();
    settle::cancel_debt<TEST>(&cfg, &mut debt, sc.ctx());
    ts::return_shared(debt);
    ts::return_shared(cfg);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = allowance::ENotSpender)]
fun only_the_agent_can_pull() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, MALLORY, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = allowance::EExceedsLifetimeCap)]
fun allowance_lifetime_cap_still_binds() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 10_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EPaused)]
fun paused_blocks_settlement() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    record(&mut sc, &clock, REGISTRAR, BEN, 12_340_000);
    sc.next_tx(ADMIN);
    {
        let cap = sc.take_from_sender<AdminCap>();
        let mut cfg = sc.take_shared<Config>();
        settle::set_paused(&cap, &mut cfg, true);
        ts::return_shared(cfg);
        sc.return_to_sender(cap);
    };
    clock.increment_for_testing(HOUR);
    pull(&mut sc, &clock, AGENT, 12_340_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EMandateNameMismatch)]
fun allowance_from_another_group_cannot_pay() {
    let (mut sc, mut clock) = setup();
    // Ana opens two mandates: one for the flat, one for a trip.
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    let flat_alw_id = ts::most_recent_id_shared<Allowance<Balance<TEST>>>().destroy_some();
    let flat_mandate_id = ts::most_recent_id_shared<Mandate>().destroy_some();
    open(&mut sc, b"lisbon", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    let trip_mandate_id = ts::most_recent_id_shared<Mandate>().destroy_some();
    assert!(flat_mandate_id != trip_mandate_id);

    // Debt recorded against the trip mandate...
    sc.next_tx(REGISTRAR);
    {
        let cfg = sc.take_shared<Config>();
        let trip = sc.take_shared_by_id<Mandate>(trip_mandate_id);
        settle::record_debt<TEST>(&cfg, &trip, g(b"t-1"), BEN, 1_000_000, &clock, sc.ctx());
        ts::return_shared(trip);
        ts::return_shared(cfg);
    };
    clock.increment_for_testing(HOUR);

    // ...cannot be pulled from the flat allowance.
    sc.next_tx(AGENT);
    let cfg = sc.take_shared<Config>();
    let trip = sc.take_shared_by_id<Mandate>(trip_mandate_id);
    let mut debt = sc.take_shared<Debt<TEST>>();
    let mut flat_alw = sc.take_shared_by_id<Allowance<Balance<TEST>>>(flat_alw_id);
    let w = allowance::new_withdrawal_for_testing(
        flat_alw_id,
        ts::withdraw_balance_from_address<TEST>(ANA, 1_000_000),
    );
    settle::settle<TEST>(&cfg, &trip, &mut debt, &mut flat_alw, w, &clock, sc.ctx());
    ts::return_shared(flat_alw);
    ts::return_shared(debt);
    ts::return_shared(trip);
    ts::return_shared(cfg);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = settle::EWrongMandate)]
fun debt_must_match_the_mandate_passed_in() {
    let (mut sc, mut clock) = setup();
    open(&mut sc, b"flat-5b", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    let flat_mandate_id = ts::most_recent_id_shared<Mandate>().destroy_some();
    let flat_alw_id = ts::most_recent_id_shared<Allowance<Balance<TEST>>>().destroy_some();
    open(&mut sc, b"lisbon", AGENT, 100_000_000, vector[BEN], 50_000_000, HOUR);
    sc.next_tx(ADMIN);
    let trip_mandate_id = ts::most_recent_id_shared<Mandate>().destroy_some();

    sc.next_tx(REGISTRAR);
    {
        let cfg = sc.take_shared<Config>();
        let trip = sc.take_shared_by_id<Mandate>(trip_mandate_id);
        settle::record_debt<TEST>(&cfg, &trip, g(b"t-1"), BEN, 1_000_000, &clock, sc.ctx());
        ts::return_shared(trip);
        ts::return_shared(cfg);
    };
    clock.increment_for_testing(HOUR);

    sc.next_tx(AGENT);
    let cfg = sc.take_shared<Config>();
    let flat = sc.take_shared_by_id<Mandate>(flat_mandate_id);
    let mut debt = sc.take_shared<Debt<TEST>>();
    let mut flat_alw = sc.take_shared_by_id<Allowance<Balance<TEST>>>(flat_alw_id);
    let w = allowance::new_withdrawal_for_testing(
        flat_alw_id,
        ts::withdraw_balance_from_address<TEST>(ANA, 1_000_000),
    );
    settle::settle<TEST>(&cfg, &flat, &mut debt, &mut flat_alw, w, &clock, sc.ctx());
    ts::return_shared(flat_alw);
    ts::return_shared(debt);
    ts::return_shared(flat);
    ts::return_shared(cfg);
    finish(sc, clock);
}
