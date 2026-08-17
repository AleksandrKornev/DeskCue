#!/usr/bin/env node

console.log("DeskCue generic echo agent ready.");
console.log("Send input from the dashboard. Type exit to stop.");

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const text = chunk.trim();
  if (!text) {
    return;
  }

  console.log(`DeskCue demo received: ${text}`);
  if (text.toLowerCase() === "exit") {
    console.log("DeskCue demo exiting.");
    process.exit(0);
  }
});
