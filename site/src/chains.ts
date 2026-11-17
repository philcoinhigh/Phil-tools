// "Same Phil, every chain": the upload every chain is given, and what the answer means.
import { uploadData, Upload } from "./draw";

export const OP_NOTE = 1, KIND_NOTE = "phil-chains/note", MAX_NOTE = 280;
/** The bytes handed to Phil's server, identical on every chain: the instruction, then the client's side of the conversation. */
export const noteData = (text: string, u: Upload = {}) => uploadData(OP_NOTE, new TextEncoder().encode(text), { kind: KIND_NOTE, ...u });

const OUTCOME: Record<number, string> = { 2: "REJECTED: the bytes do not match the digest they declared", 3: "no protocol version in common", 4: "refused by policy before any payload was read", 5: "cancelled by the client",
  6: "a frame was not recognized", 7: "the hello was refused by policy", 8: "valid, but could not be carried out", 9: "fewer bytes arrived than were declared" };
/** The program's answer in words. It is the same number on every chain. */
export function explainCode(code: number): string {
  if (code === 0) return "ACCEPTED";
  if (code === 120) return "refused: bytes were left over after the upload";
  if (code === 102 || code === 103) return "refused: not an instruction this program knows";
  if (code >= 2000) return "refused: the server broke one of the protocol's ownership rules";
  return OUTCOME[Math.floor((code - 1000) / 100)] ?? `refused (${code})`;
}
