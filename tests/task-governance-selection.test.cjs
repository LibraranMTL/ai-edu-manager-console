const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../electron/main.cjs"),
  "utf8",
);
const start = source.indexOf("function resolveTaskGovernanceSelection(");
const end = source.indexOf("\nfunction previewTaskGovernanceBatch(", start);
assert.ok(start >= 0 && end > start, "resolveTaskGovernanceSelection source");

function loadSelector() {
  const context = vm.createContext({
    taskPresentation: (task) => ({ statusGroup: task.statusGroup }),
  });
  vm.runInContext(source.slice(start, end), context);
  return context.resolveTaskGovernanceSelection;
}

test("filtered batch selection covers every matching page without widening source or executor", () => {
  const select = loadSelector();
  const store = {
    tasks: [
      {
        id: "s1",
        statusGroup: "actionable",
        sourceType: "student",
        executor: "codex",
      },
      {
        id: "s2",
        statusGroup: "actionable",
        sourceType: "student",
        executor: "workbuddy",
      },
      {
        id: "p1",
        statusGroup: "actionable",
        sourceType: "project",
        executor: "codex",
      },
      {
        id: "done",
        statusGroup: "completed",
        sourceType: "student",
        executor: "codex",
      },
    ],
  };
  const result = select(store, {
    selection: "filtered",
    query: { status: "actionable", source: "student", executor: "codex" },
  });
  assert.deepEqual([...result.ids], ["s1"]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.truncated, false);
});
test("filtered and explicit selections are bounded to one thousand tasks", () => {
  const select = loadSelector();
  const tasks = Array.from({ length: 1002 }, (_, index) => ({
    id: `task-${index}`,
    statusGroup: "actionable",
    sourceType: "student",
    executor: "codex",
  }));
  const filtered = select(
    { tasks },
    {
      selection: "filtered",
      query: { status: "actionable", source: "all", executor: "all" },
    },
  );
  assert.equal(filtered.ids.length, 1000);
  assert.equal(filtered.matchedCount, 1002);
  assert.equal(filtered.truncated, true);
  const explicit = select({ tasks: [] }, { ids: tasks.map((task) => task.id) });
  assert.equal(explicit.ids.length, 1000);
  assert.equal(explicit.truncated, true);
});
