import test from "node:test";
import assert from "node:assert/strict";
import { consistIncludesSetNumber, getMatchingSetNumbers, getTrainFleetTypes, isKnownFleetType, xtrapolis2CarNumberCandidates } from "./fleet-tracking.js";

test("letter-prefixed V/Line and loco codes are not read as suburban car numbers", () => {
  assert.deepEqual(getMatchingSetNumbers("VL15", "xtrapolis"), []);
  assert.deepEqual(getMatchingSetNumbers("VL15+VL20", "xtrapolis"), []);
  assert.deepEqual(getMatchingSetNumbers("N452", "comeng"), []);
  assert.deepEqual(getMatchingSetNumbers("N452", "n-class"), ["N452"]);
  assert.deepEqual(getMatchingSetNumbers("15M-16M", "xtrapolis"), ["15M", "16M"]);
  assert.deepEqual(getTrainFleetTypes({ consist: "N452", tripId: "02-x" }), ["n-class"]);
});

test("the Comeng builder filters used by the fleet board are recognised and split", () => {
  assert.ok(isKnownFleetType("alstom-comeng"));
  assert.ok(isKnownFleetType("edi-comeng"));
  // 429M is an EDI motor; 333M is not.
  assert.deepEqual(getMatchingSetNumbers("429M-1015T-430M", "edi-comeng"), ["429M", "430M"]);
  assert.deepEqual(getMatchingSetNumbers("429M-1015T-430M", "alstom-comeng"), []);
  assert.deepEqual(getMatchingSetNumbers("333M-334M", "alstom-comeng"), ["333M", "334M"]);
  assert.deepEqual(getTrainFleetTypes({ consist: "429M-430M", tripId: "02-x" }), ["comeng"]);
});

test("X'Trapolis 2.0 roster set numbers can be looked up directly", () => {
  const cars = ["8105", "8205", "8305", "8405", "8505", "8605"];
  assert.deepEqual(xtrapolis2CarNumberCandidates("8005"), cars);
  assert.deepEqual(xtrapolis2CarNumberCandidates("5"), cars);
  assert.deepEqual(xtrapolis2CarNumberCandidates("8051"), []);
  assert.deepEqual(getMatchingSetNumbers("8105-8205-8305", "xtrapolis2"), ["8005"]);
});

test("set search splits on the same separators as notifications", () => {
  assert.ok(consistIncludesSetNumber("VL15+VL20", "VL20"));
  assert.ok(consistIncludesSetNumber("429M 430M", "430M"));
  assert.ok(!consistIncludesSetNumber("429M-430M", "30M"));
});
