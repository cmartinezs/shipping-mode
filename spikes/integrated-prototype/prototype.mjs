import crypto from "node:crypto";
import { evaluate } from "../../scripts/protect-planning-state.mjs";

export function runVerticalSlice() {
  const state = { entities: [], changesets: [], events: [] };
  const steps = ["init", "config", "release", "item", "work-package", "task", "propose", "apply", "check", "report"];
  for (const step of steps.slice(0, 7)) state.events.push({ type: step, status: "proposed" });
  const changeset = {
    id: "cs-1",
    operations: [{ type: "create", aggregate: "task", id: "task-1" }]
  };
  changeset.hash = crypto.createHash("sha256").update(JSON.stringify(changeset.operations)).digest("hex");
  state.changesets.push(changeset);
  state.entities.push({ type: "task", id: "task-1" });
  state.events.push({ type: "apply", changeset: changeset.id, hash: changeset.hash });
  state.events.push({ type: "check", status: "PASSED" });
  state.events.push({ type: "report", status: "READY" });
  return { state, steps };
}

export function directWriteIsBlocked() {
  return evaluate({ tool_name: "Bash", tool_input: { command: "echo bad > .planning/state.json" } }, {
    workspaceRoot: process.cwd(),
    approvedLauncher: "shipping-mode"
  })?.hookSpecificOutput?.permissionDecision === "deny";
}
