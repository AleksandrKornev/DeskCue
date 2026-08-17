export default class RequireExecutedReporter {
  executedTests = 0;

  onTestEnd(_test, result) {
    if (result.status !== "skipped") {
      this.executedTests += 1;
    }
  }

  onEnd(result) {
    if (this.executedTests > 0) {
      return result;
    }

    console.error([
      "DeskCue Playwright run executed zero tests.",
      "Provide the target variables required by the selected scenario, or use",
      "`npm run test:e2e:optional --workspace @deskcue/web -- <spec>` while preparing a fixture."
    ].join(" "));
    return { status: "failed" };
  }
}
