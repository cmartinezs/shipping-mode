import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const aggregateDirs = {
  release: "releases",
  item: "items",
  "work-package": "work-packages",
  task: "tasks"
};

function id() {
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const random = crypto.randomBytes(10).toString("hex");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(0, 3)}-8${random.slice(3, 6)}-${random.slice(6).padEnd(12, "0").slice(0, 12)}`;
}

function planningRoot(cwd) {
  return path.join(cwd, ".planning");
}

function ensurePlanning(cwd) {
  const root = planningRoot(cwd);
  if (!fs.existsSync(root)) throw new Error("Shipping Mode is not initialized; run `shipping-mode init` first.");
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function event(root, type, data = {}) {
  fs.mkdirSync(path.join(root, "events"), { recursive: true });
  fs.appendFileSync(path.join(root, "events", "journal.jsonl"), `${JSON.stringify({ id: id(), type, at: new Date().toISOString(), ...data })}\n`);
}

function createChangeSet(root, operation) {
  const changeset = { id: id(), status: "PROPOSED", operations: [operation] };
  changeset.hash = crypto.createHash("sha256").update(JSON.stringify(changeset.operations)).digest("hex");
  writeJson(path.join(root, "operations", `${changeset.id}.json`), changeset);
  event(root, "changeset.proposed", { changeset_id: changeset.id, hash: changeset.hash });
  return changeset;
}

function aggregatePayload(root, operation) {
  const directory = aggregateDirs[operation.kind];
  const aggregateId = id();
  const existing = fs.readdirSync(path.join(root, directory), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length + 1;
  return {
    id: aggregateId,
    display_id: `${operation.kind.toUpperCase().replace("-", "")}\u002d${String(existing).padStart(4, "0")}`,
    name: operation.name,
    parent_id: operation.parent_id || null,
    kind: operation.kind,
    status: "PLANNED"
  };
}

function applyChangeSet(root, changeset) {
  if (changeset.status === "APPLIED") return changeset;
  for (const operation of changeset.operations) {
    if (operation.kind === "config") writeJson(path.join(root, "config.json"), { name: operation.name, schema_version: 1 });
    else {
      const aggregate = aggregatePayload(root, operation);
      writeJson(path.join(root, aggregateDirs[operation.kind], aggregate.id, "record.json"), aggregate);
    }
  }
  changeset.status = "APPLIED";
  changeset.applied_at = new Date().toISOString();
  writeJson(path.join(root, "operations", `${changeset.id}.json`), changeset);
  event(root, "changeset.applied", { changeset_id: changeset.id, hash: changeset.hash });
  return changeset;
}

function argsToOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    options[args[index].slice(2).replaceAll("-", "_")] = args[index + 1]?.startsWith("--") ? true : args[++index];
  }
  return options;
}

export function execute(command, args = [], cwd = process.cwd()) {
  if (command === "init") {
    const root = planningRoot(cwd);
    for (const directory of ["releases", "items", "work-packages", "tasks", "operations", "events", "approvals", "schemas", "template-pack"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
    writeJson(path.join(root, "project.json"), { schema_version: 1, product: "shipping-mode" });
    writeJson(path.join(root, "schemas", "control-plane.json"), { schema_version: 1, protected: true });
    writeJson(path.join(root, "template-pack", "manifest.json"), { name: "shipping-mode-default", version: "1.0.0" });
    event(root, "project.initialized");
    return { status: "APPLIED", command, planning: ".planning" };
  }

  const root = ensurePlanning(cwd);
  if (command === "config") {
    const changeset = createChangeSet(root, { kind: "config", name: argsToOptions(args).name || "Shipping Mode project" });
    return applyChangeSet(root, changeset);
  }
  if (aggregateDirs[command]) {
    const options = argsToOptions(args);
    const parent = options.release || options.item || options.work_package;
    const changeset = createChangeSet(root, { kind: command, name: options.name || `${command} proposal`, parent_id: parent });
    return applyChangeSet(root, changeset);
  }
  if (command === "propose") {
    const options = argsToOptions(args);
    return createChangeSet(root, { kind: options.kind || "task", name: options.name || "proposal", parent_id: options.parent });
  }
  if (command === "apply") {
    const options = argsToOptions(args);
    const file = fs.readdirSync(path.join(root, "operations")).find((entry) => entry.startsWith(options.changeset || "missing"));
    if (!file) throw new Error("changeset not found");
    return applyChangeSet(root, JSON.parse(fs.readFileSync(path.join(root, "operations", file), "utf8")));
  }
  if (command === "check") {
    const required = ["project.json", "schemas/control-plane.json", "template-pack/manifest.json", "events/journal.jsonl"];
    return { status: required.every((file) => fs.existsSync(path.join(root, file))) ? "PASS" : "FAIL", command };
  }
  if (command === "report") {
    const counts = Object.fromEntries(Object.entries(aggregateDirs).map(([kind, directory]) => [kind, fs.readdirSync(path.join(root, directory), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length]));
    return { status: "READY", command, counts };
  }
  throw new Error(`unsupported-command:${command}`);
}
