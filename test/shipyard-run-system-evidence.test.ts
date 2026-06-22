import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const evidenceRoot = join(
  process.cwd(),
  "docs",
  "evidence",
  "shipyard-glm-tool-plan-run-system-20260622",
);
const gateUpgradeEvidenceRoot = join(
  process.cwd(),
  "docs",
  "evidence",
  "shipyard-run-system-gate-upgrade-20260622",
);
const externalCliEvidenceRoot = join(
  process.cwd(),
  "docs",
  "evidence",
  "shipyard-external-cli-adapter-20260622",
);

describe("Shipyard GLM tool_plan Run System evidence", () => {
  it("keeps manual-bb gate sections in the required review order", () => {
    const gate = readFileSync(join(evidenceRoot, "manual-bb-gate.md"), "utf8");
    const sections = [
      "## 1. 根拠付き観点",
      "## 2. リスク",
      "## 3. 優先度",
      "## 4. 手動テストケース",
      "## 5. 工数",
      "## 6. Gate 判定",
      "## 7. Go/No-Go brief",
    ];

    const positions = sections.map((section) => gate.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(gate).toContain("判定: go");
    expect(gate).toContain("RISK-SY-002");
    expect(gate).toContain("RISK-SY-005");
    expect(gate).toContain("mitigated");
  });

  it("keeps manual-bb JSON and QEG expected verdict aligned", () => {
    const manual = JSON.parse(
      readFileSync(join(evidenceRoot, "manual-bb-artifacts.json"), "utf8"),
    ) as {
      gate_decision: { verdict: string; blockers: string[]; residual_risks: string[] };
    };
    const expected = JSON.parse(
      readFileSync(join(evidenceRoot, "qeg", "expected-gate-verdict.json"), "utf8"),
    ) as {
      expectedVerdict: string;
      expectedBlockers: unknown[];
      expectedResidualRisks: string[];
    };

    expect(manual.gate_decision.verdict).toBe(expected.expectedVerdict);
    expect(manual.gate_decision.blockers).toEqual(expected.expectedBlockers);
    expect(manual.gate_decision.residual_risks).toEqual(expected.expectedResidualRisks);
  });

  it("connects the QEG fixture to all four OSS advisory targets", () => {
    const gateInput = readFileSync(join(evidenceRoot, "qeg", "gate-input.json"), "utf8");

    expect(gateInput).toContain("agent-protocols");
    expect(gateInput).toContain("agent-taskstate");
    expect(gateInput).toContain("agent-gatefield");
    expect(gateInput).toContain("agent-state-gate");
  });

  it("keeps the gate upgrade manual-bb package in the required review order", () => {
    const gate = readFileSync(join(gateUpgradeEvidenceRoot, "manual-bb-gate.md"), "utf8");
    const sections = [
      "## 1. 根拠付き観点",
      "## 2. リスク",
      "## 3. 優先度",
      "## 4. 手動テストケース",
      "## 5. 工数",
      "## 6. Gate 判定",
      "## 7. Go/No-Go brief",
    ];

    const positions = sections.map((section) => gate.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(gate).toContain("判定: go");
    expect(gate).toContain("advisory");
    expect(gate).toContain("enforce");
  });

  it("keeps the gate upgrade QEG fixture aligned with manual-bb Go", () => {
    const manual = JSON.parse(
      readFileSync(join(gateUpgradeEvidenceRoot, "manual-bb-artifacts.json"), "utf8"),
    ) as {
      gate_decision: { verdict: string; blockers: string[]; residual_risks: string[] };
    };
    const expected = JSON.parse(
      readFileSync(join(gateUpgradeEvidenceRoot, "qeg", "expected-gate-verdict.json"), "utf8"),
    ) as {
      expectedVerdict: string;
      expectedBlockers: unknown[];
      expectedResidualRisks: string[];
    };
    const gateInput = readFileSync(join(gateUpgradeEvidenceRoot, "qeg", "gate-input.json"), "utf8");

    expect(manual.gate_decision.verdict).toBe(expected.expectedVerdict);
    expect(manual.gate_decision.blockers).toEqual(expected.expectedBlockers);
    expect(manual.gate_decision.residual_risks).toEqual(expected.expectedResidualRisks);
    expect(gateInput).toContain("agent-protocols");
    expect(gateInput).toContain("agent-taskstate");
    expect(gateInput).toContain("agent-gatefield");
    expect(gateInput).toContain("agent-state-gate");
  });

  it("keeps the external CLI adapter manual-bb package in the required review order", () => {
    const gate = readFileSync(join(externalCliEvidenceRoot, "manual-bb-gate.md"), "utf8");
    const sections = [
      "## 1. 根拠付き観点",
      "## 2. リスク",
      "## 3. 優先度",
      "## 4. 手動テストケース",
      "## 5. 工数",
      "## 6. Gate 判定",
      "## 7. Go/No-Go brief",
    ];

    const positions = sections.map((section) => gate.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(gate).toContain("判定: go");
    expect(gate).toContain("agent-gatefield");
    expect(gate).toContain("agent-state-gate");
  });

  it("keeps the external CLI adapter QEG fixture aligned with manual-bb Go", () => {
    const manual = JSON.parse(
      readFileSync(join(externalCliEvidenceRoot, "manual-bb-artifacts.json"), "utf8"),
    ) as {
      gate_decision: { verdict: string; blockers: string[]; residual_risks: string[] };
    };
    const expected = JSON.parse(
      readFileSync(join(externalCliEvidenceRoot, "qeg", "expected-gate-verdict.json"), "utf8"),
    ) as {
      expectedVerdict: string;
      expectedBlockers: unknown[];
      expectedResidualRisks: string[];
    };
    const smoke = readFileSync(join(externalCliEvidenceRoot, "external-cli-smoke.json"), "utf8");
    const gateInput = readFileSync(join(externalCliEvidenceRoot, "qeg", "gate-input.json"), "utf8");

    expect(manual.gate_decision.verdict).toBe(expected.expectedVerdict);
    expect(manual.gate_decision.blockers).toEqual(expected.expectedBlockers);
    expect(manual.gate_decision.residual_risks).toEqual(expected.expectedResidualRisks);
    expect(smoke).toContain('"system": "agent-protocols"');
    expect(smoke).toContain('"system": "agent-taskstate"');
    expect(smoke).toContain('"system": "agent-gatefield"');
    expect(smoke).toContain('"system": "agent-state-gate"');
    expect(gateInput).toContain("RUN_SYSTEM_EXTERNAL_CLI_ADAPTER_REQUIREMENTS.md");
  });
});
