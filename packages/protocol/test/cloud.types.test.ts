import {
  CLOUD_RELAY_V1_CONTRACT_FIXTURES,
  CLOUD_RELAY_V1_CONTRACT_MANIFEST,
  parseCloudRemoteReadOperationInput,
  parseRemoteControlOperationInput,
  type CloudRemoteReadOperationInput,
  type CloudRemoteReadOperationInputMap,
  type RemoteControlOperationInput,
  type RemoteControlOperationInputMap
} from "../src/index.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const overview = parseCloudRemoteReadOperationInput("overview.get", { sessionLimit: 10 });
type OverviewIsOperationSpecific = Expect<Equal<
  typeof overview,
  CloudRemoteReadOperationInputMap["overview.get"]
>>;
const overviewLimit: number | undefined = overview.sessionLimit;
// @ts-expect-error overview input cannot expose a session identity
overview.sessionId;

const reviewed = parseCloudRemoteReadOperationInput("sessions.reviewed.post", {
  agentSessionId: "agent-1"
});
const reviewedSessionId: string = reviewed.agentSessionId;

const changes = parseCloudRemoteReadOperationInput("changes.post", {
  agentSessionId: "agent-1",
  groupId: "group-1",
  sourceEntryRanges: [{ prefix: "entry", start: 1, end: 2 }]
});
type ChangesAreOperationSpecific = Expect<Equal<
  typeof changes,
  CloudRemoteReadOperationInputMap["changes.post"]
>>;
const rangeStart: number | undefined = changes.sourceEntryRanges?.[0]?.start;
// @ts-expect-error changes input cannot expose transcript paging fields
changes.beforeEntryId;

const managedInput = parseRemoteControlOperationInput("managed.input", {
  sessionId: "session-1",
  input: "continue"
});
type ManagedInputIsOperationSpecific = Expect<Equal<
  typeof managedInput,
  RemoteControlOperationInputMap["managed.input"]
>>;
const prompt: string = managedInput.input;
// @ts-expect-error managed input cannot expose source attach identity
managedInput.agentSessionId;

const compatibleTaggedInput: RemoteControlOperationInput = {
  operation: "source.attach",
  input: { agentSessionId: "source-1" }
};
const anyReadInput: CloudRemoteReadOperationInput = overview;
const manifestVersion: 1 = CLOUD_RELAY_V1_CONTRACT_MANIFEST.manifestVersion;
const fixtureInput: string =
  CLOUD_RELAY_V1_CONTRACT_FIXTURES.remoteControlInputs["managed.input"].input.input;

void (0 as unknown as OverviewIsOperationSpecific);
void (0 as unknown as ChangesAreOperationSpecific);
void (0 as unknown as ManagedInputIsOperationSpecific);
void overviewLimit;
void reviewedSessionId;
void rangeStart;
void prompt;
void compatibleTaggedInput;
void anyReadInput;
void manifestVersion;
void fixtureInput;
