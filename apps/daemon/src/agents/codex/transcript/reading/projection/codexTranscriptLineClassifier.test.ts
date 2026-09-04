import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyIndexedTranscriptActivityLine,
  readCodexTranscriptLineTypeHint
} from "./codexTranscriptLineClassifier.ts";

function classify(record: Record<string, unknown>) {
  return classifyIndexedTranscriptActivityLine(
    readCodexTranscriptLineTypeHint(JSON.stringify(record))
  );
}

test("classifies large FileChange items independently of type and changes order", () => {
  const changes = {
    "src/large.ts": {
      type: "update",
      unified_diff: "x".repeat(20_000)
    }
  };

  assert.equal(classify({
    type: "event_msg",
    timestamp: "2026-09-02T10:00:00.000Z",
    payload: {
      type: "item_completed",
      item: {
        type: "FileChange",
        changes,
        status: "completed"
      }
    }
  }), "changes");
  assert.equal(classify({
    type: "event_msg",
    timestamp: "2026-09-02T10:00:00.000Z",
    payload: {
      type: "item_completed",
      item: {
        changes,
        type: "FileChange",
        status: "completed"
      }
    }
  }), "changes");
});

test("does not classify nested FileChange metadata as changes", () => {
  assert.equal(classify({
    type: "event_msg",
    timestamp: "2026-09-02T10:00:00.000Z",
    payload: {
      type: "item_completed",
      metadata: {
        item: {
          type: "FileChange",
          changes: {}
        }
      }
    }
  }), null);
});

test("classifies FileChange when root and payload properties are reordered", () => {
  assert.equal(classify({
    payload: {
      item: {
        changes: {
          "src/app.ts": {
            type: "update",
            unified_diff: "x".repeat(20_000)
          }
        },
        type: "FileChange"
      },
      type: "item_completed"
    },
    timestamp: "2026-09-02T10:00:00.000Z",
    type: "event_msg"
  }), "changes");
});

test("does not infer FileChange from a large direct changes property", () => {
  assert.equal(classify({
    payload: {
      item: {
        changes: {
          "src/app.ts": {
            type: "update",
            unified_diff: "x".repeat(20_000)
          }
        },
        type: "Other"
      },
      type: "item_completed"
    },
    timestamp: "2026-09-02T10:00:00.000Z",
    type: "event_msg"
  }), null);
});

test("classifies FileChange after properties beyond the indexed hint window", () => {
  assert.equal(classify({
    payload: {
      item: {
        changes: {
          "src/app.ts": {
            type: "update",
            unified_diff: "x".repeat(300_000)
          }
        },
        type: "FileChange"
      },
      type: "item_completed"
    },
    padding: "x".repeat(300_000),
    timestamp: "2026-09-02T10:00:00.000Z",
    type: "event_msg"
  }), "changes");
});

test("requires canonical outer FileChange discriminants", () => {
  const item = {
    type: "FileChange",
    changes: {
      "src/app.ts": {
        type: "update",
        unified_diff: "-old\n+new"
      }
    }
  };

  assert.equal(classify({ payload: { type: "item_completed", item } }), null);
  assert.equal(classify({ type: "event_msg", payload: { item } }), null);
});
