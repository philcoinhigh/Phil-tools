// One runtime for Phil's upload server, built for more than one chain from this single file.
//
// `UploadServer` is the function Phil's LLVM backend emits. The very same emitted module is
// compiled here for two machines:
//
//   Solana    to SBF, as a native Solana program (the same way as the other programs in this repo).
//   RISC-V    to rv64im, a plain machine image. Ethereum-style chains cannot run Phil's output
//             directly (Phil has no EVM backend), so there the image is executed, instruction by
//             instruction, by a small RISC-V interpreter contract (chains/PhilRiscV.sol). That one
//             contract is ordinary EVM code, so it runs on Robinhood Chain, BNB Chain, or any other
//             EVM chain.
//
// What the program does is the same everywhere: it takes one upload (a "note"), runs Phil's server
// over it, and answers ACCEPTED or says why not. It keeps no state: the point is that the same
// Phil code gives the same verdict on every chain. The numbers it returns are the ones the other
// programs here use: 0 accepted, otherwise 1000 + 100 x outcome + reason.
//
// Phil's server checks the upload's handshake, its policy and that the bytes match their declared
// SHA-256. This file (the runtime it calls) and the interpreter contract are ours and are not Phil.
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long u64;
#define bool _Bool
#define NULL ((void *)0)

// What the host provides: a log line and SHA-256. On Solana these are the virtual machine's own
// calls (and the native harness's, in tests). On RISC-V they are two "ecall" requests that the
// interpreter answers: a7 = 1 log(a0 = text, a1 = length), a7 = 2 sha256(a0 = bytes, a1 = length,
// a2 = 32 bytes out), and a7 = 0 ends the run with a0 as the result.
struct sol_bytes { const u8 *addr; u64 len; };
#ifdef __riscv
static u64 host(u64 call, u64 a, u64 b, u64 c) {
  register u64 a0 __asm__("a0") = a; register u64 a1 __asm__("a1") = b; register u64 a2 __asm__("a2") = c; register u64 a7 __asm__("a7") = call;
  __asm__ volatile("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a7) : "memory");
  return a0;
}
static void sol_log_(const char *message, u64 length) { host(1, (u64)message, length, 0); }
static u64 sol_sha256(const struct sol_bytes *parts, u64 count, u8 *out) { (void)count; host(2, (u64)parts[0].addr, parts[0].len, (u64)out); return 0; }   /* only ever one part here */
#else
extern void sol_log_(const char *message, u64 length);
extern u64 sol_sha256(const struct sol_bytes *parts, u64 count, u8 *out);
#endif
extern int UploadServer(void *policy_context, void *supported_versions, void *transport);

#define LOG(text) sol_log_(text, sizeof(text) - 1)

// ---- small helpers (the compiler may also call these by name) ----
void *memcpy(void *dst, const void *src, u64 n) { u8 *d = dst; const u8 *s = src; while (n--) *d++ = *s++; return dst; }
void *memset(void *dst, int c, u64 n) { u8 *d = dst; while (n--) *d++ = (u8)c; return dst; }
int memcmp(const void *a, const void *b, u64 n) { const u8 *x = a, *y = b; while (n--) { if (*x != *y) return *x < *y ? -1 : 1; x++; y++; } return 0; }
static bool same(const u8 *a, const u8 *b, u64 n) { u8 diff = 0; while (n--) diff |= (u8)(*a++ ^ *b++); return diff == 0; }
static u16 be16(const u8 *p) { return (u16)((p[0] << 8) | p[1]); }
static u64 be64(const u8 *p) { u64 v = 0; for (int i = 0; i < 8; i++) v = (v << 8) | p[i]; return v; }
#ifndef __riscv
static u64 le64(const u8 *p) { u64 v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | p[i]; return v; }
#endif

// ---- instructions, outcomes, limits ----
enum { OP_NOTE = 1 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2 };
#define MAX_PAYLOAD 280u
static const char KIND_NOTE[] = "phil-chains/note";

// ---- working state, in the heap region ----
struct transport { const u8 *bytes; u64 available; u64 cursor; };
struct frame { const u8 *bytes; u64 length; u8 tag; u8 problem; u8 stage; };   /* stage: 0 none, 1 pending, 2 committed, 3 destroyed */
struct hello { const u8 *versions; u16 count; };
struct begin { u64 length; const u8 *kind; const u8 *digest; u8 kind_len; };
struct payload { const u8 *bytes; u64 length; u8 held; };
struct state {
  struct transport transport;
  struct frame hello_frame, begin_frame;
  u8 hello_pending, begin_pending;            /* what "pending" points at: a different object from the frame */
  u8 hello_recognition_reason, begin_recognition_reason, hello_policy_reason, storage_reason;
  struct hello hello;
  struct begin begin;
  struct payload payload;
  u8 computed[32];
  u16 supported[2];
  u16 chosen_version;
  u8 op, outcome, reason;
  u8 violation, policy_reason, digest_ok, stored, payload_taken;
  u8 upload_id;                               /* what "the stored upload" points at */
};
#ifdef __riscv
static struct state the_state;
#define S (&the_state)
#else
#define S ((struct state *)0x300000000UL)     /* Solana's heap region, which starts zeroed */
#endif

// ================= the interface Phil's upload server calls =================
//
// This runtime also checks the server. Phil's type system promises that every owner is used
// exactly once and in order: a received frame is committed or destroyed, a payload is stored or
// released, nothing is stored before its digest was validated, and every call is about the
// object the protocol says it is about. Those promises are erased before LLVM, so here each
// call is checked against them as it happens. One broken rule fails the transaction.
static void violate(u8 code) { if (!S->violation) S->violation = code; }
#define MUST(condition, code) do { if (!(condition)) violate(code); } while (0)
#define TRANSPORT_IS_OURS(t) ((void *)(t) == (void *)&S->transport)
// Tests only (never defined for the Solana build): make one call answer with the reserved
// status 2, which a conforming runtime never returns, to check the server fails closed on it.
#ifdef PHIL_RUNTIME_FAULTS
extern u8 phil_fault;
#define FAULT(n) (phil_fault == (n))
#else
#define FAULT(n) 0
#endif

static void receive_frame(struct transport *t, u8 tag, struct frame *f, void **pending_out, void **frame_out) {
  const u8 *b = t->bytes + t->cursor;
  u64 left = t->available - t->cursor;
  MUST(TRANSPORT_IS_OURS(t), 1); MUST(f->stage == 0, 2);
  f->bytes = b; f->tag = tag; f->length = 0; f->problem = 0; f->stage = 1;
  if (left < 8) f->problem = 2;                                                  /* short header */
  else if (b[0] != 0x50 || b[1] != 0x48 || b[2] != 0x49 || b[3] != 0x4c) f->problem = 3;   /* "PHIL" */
  else if (b[4] != 1) f->problem = 4;                                            /* codec version */
  else if (b[5] != tag) f->problem = 5;
  else if (left < 8u + be16(b + 6)) f->problem = 6;                              /* truncated */
  else f->length = 8u + be16(b + 6);
  *pending_out = tag == 1 ? &S->hello_pending : &S->begin_pending; *frame_out = f;
}
void phil_runtime_receive_frame_Hello(void *transport, void **pending_out, void **frame_out) { receive_frame(transport, 1, &S->hello_frame, pending_out, frame_out); }
void phil_runtime_receive_frame_Begin(void *transport, void **pending_out, void **frame_out) { receive_frame(transport, 2, &S->begin_frame, pending_out, frame_out); }
void *phil_runtime_frame_borrow_view_Hello(void *frame) { MUST(frame == &S->hello_frame && S->hello_frame.stage == 1, 3); return frame; }
void *phil_runtime_frame_borrow_view_Begin(void *frame) { MUST(frame == &S->begin_frame && S->begin_frame.stage == 1, 3); return frame; }

u8 phil_runtime_recognize_Hello(void *pending, void *raw_view, void **record_out, void **reason_out) {
  struct frame *f = raw_view;
  const u8 *p = f->bytes + 8;
  u64 n = f->length - 8;
  u8 why = 0;
  *record_out = NULL; *reason_out = &S->hello_recognition_reason;
  MUST(pending == &S->hello_pending && raw_view == &S->hello_frame && S->hello_frame.stage == 1, 4);
  if (S->violation) return 0;
  if (f->problem) why = (u8)(50 + f->problem);   /* 52 short header, 53 not "PHIL", 54 codec version, 55 wrong frame, 56 truncated */
  else if (n < 2) why = 2;
  else if (be16(p) == 0) why = 1;
  else if (2u + 2u * be16(p) != n) why = 2;
  else for (u16 i = 1; i < be16(p); i++) if (be16(p + 2 * i) >= be16(p + 2 + 2 * i)) why = 3;   /* strictly ascending */
  if (why) { S->hello_recognition_reason = why; return 0; }
  S->hello.count = be16(p); S->hello.versions = p + 2;
  *record_out = &S->hello;
  LOG("Phil: Hello recognized");
  return FAULT(1) ? 2 : 1;
}
u8 phil_runtime_recognize_Begin(void *pending, void *raw_view, void **record_out, void **reason_out) {
  struct frame *f = raw_view;
  const u8 *p = f->bytes + 8;
  u64 n = f->length - 8;
  u8 why = 0;
  *record_out = NULL; *reason_out = &S->begin_recognition_reason;
  MUST(pending == &S->begin_pending && raw_view == &S->begin_frame && S->begin_frame.stage == 1, 4);
  if (S->violation) return 0;
  if (f->problem) why = (u8)(50 + f->problem);   /* 52 short header, 53 not "PHIL", 54 codec version, 55 wrong frame, 56 truncated */
  else if (n < 42) why = 1;
  else if (p[8] == 0) why = 2;
  else if (42u + p[8] != n) why = 1;
  else if (p[9 + p[8]] != 1) why = 3;                                            /* SHA-256 only */
  if (why) { S->begin_recognition_reason = why; return 0; }
  S->begin.length = be64(p); S->begin.kind_len = p[8]; S->begin.kind = p + 9; S->begin.digest = p + 10 + p[8];
  *record_out = &S->begin;
  LOG("Phil: Begin recognized");
  return FAULT(2) ? 2 : 1;
}
void phil_runtime_commit_ingress_Hello(void *transport, void *pending) {
  MUST(TRANSPORT_IS_OURS(transport) && pending == &S->hello_pending && S->hello_frame.stage == 1, 5);
  if (S->violation) return;
  S->transport.cursor += S->hello_frame.length; S->hello_frame.stage = 2;
}
void phil_runtime_commit_ingress_Begin(void *transport, void *pending) {
  MUST(TRANSPORT_IS_OURS(transport) && pending == &S->begin_pending && S->begin_frame.stage == 1, 5);
  if (S->violation) return;
  S->transport.cursor += S->begin_frame.length; S->begin_frame.stage = 2;
}
void phil_runtime_fail_recognition_Hello(void *pending, void *reason) { MUST(pending == &S->hello_pending && S->hello_frame.stage == 1 && reason == &S->hello_recognition_reason, 6); if (S->violation) return; S->outcome = RECOGNITION_FAILED; S->reason = S->hello_recognition_reason; LOG("Phil: the Hello frame was not recognized"); }
void phil_runtime_fail_recognition_Begin(void *pending, void *reason) { MUST(pending == &S->begin_pending && S->begin_frame.stage == 1 && reason == &S->begin_recognition_reason, 6); if (S->violation) return; S->outcome = RECOGNITION_FAILED; S->reason = S->begin_recognition_reason; LOG("Phil: the Begin frame was not recognized"); }
void phil_runtime_destroy_pending_Hello(void *pending, void *frame) { MUST(pending == &S->hello_pending && frame == &S->hello_frame && S->hello_frame.stage == 1, 7); if (!S->violation) S->hello_frame.stage = 3; }
void phil_runtime_destroy_pending_Begin(void *pending, void *frame) { MUST(pending == &S->begin_pending && frame == &S->begin_frame && S->begin_frame.stage == 1, 7); if (!S->violation) S->begin_frame.stage = 3; }

void *phil_record_Hello_get_versions(void *hello_record) { MUST(hello_record == &S->hello && S->hello_frame.stage == 2, 8); return &S->hello; }
u64 phil_record_Begin_get_length(void *begin_record) { MUST(begin_record == &S->begin && S->begin_frame.stage == 2, 8); return S->begin.length; }

bool phil_runtime_validate_hello_policy(void *policy_context, void *hello_record, void **rejection_reason_out) {
  (void)policy_context;
  MUST(hello_record == &S->hello && S->hello_frame.stage == 2, 9);
  *rejection_reason_out = &S->hello_policy_reason;
  if (S->hello.count > 16) { S->hello_policy_reason = 1; return 0; }
  return 1;
}
void phil_runtime_fail_hello_policy(void *transport, void *rejection_reason) { MUST(TRANSPORT_IS_OURS(transport) && rejection_reason == &S->hello_policy_reason, 10); if (S->violation) return; S->outcome = HELLO_POLICY_FAILED; S->reason = S->hello_policy_reason; LOG("Phil: the Hello was refused by policy"); }

bool phil_runtime_choose_supported(void *server_supported, void *offered_versions, u16 *selected_version_out) {
  const u16 *mine = S->supported;           /* a count, then the versions */
  struct hello *theirs = &S->hello;
  bool found = 0; u16 best = 0;
  MUST(server_supported == S->supported && offered_versions == &S->hello, 11);
  for (u16 i = 0; i < theirs->count; i++) for (u16 j = 0; j < mine[0]; j++)
    if (be16(theirs->versions + 2 * i) == mine[1 + j] && (!found || mine[1 + j] > best)) { found = 1; best = mine[1 + j]; }
  if (found) { *selected_version_out = best; S->chosen_version = best; }
  return found;
}
void phil_runtime_select_unsupported(void *transport) { MUST(TRANSPORT_IS_OURS(transport) && S->chosen_version == 0, 12); if (S->violation) return; S->outcome = UNSUPPORTED; LOG("Phil: no protocol version in common"); }
void phil_runtime_select_version(void *transport, u16 selected_version) { MUST(TRANSPORT_IS_OURS(transport) && selected_version != 0 && selected_version == S->chosen_version, 13); LOG("Phil: version agreed"); }

bool phil_runtime_validate_begin_policy(void *policy_context, void *begin_record, u8 *rejection_reason_out) {
  struct begin *b = begin_record;
  u8 why = 0;
  (void)policy_context;
  MUST(begin_record == &S->begin && S->begin_frame.stage == 2, 14);
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != sizeof(KIND_NOTE) - 1 || !same(b->kind, (const u8 *)KIND_NOTE, sizeof(KIND_NOTE) - 1)) why = POLICY_WRONG_KIND;
  if (why) { *rejection_reason_out = why; S->policy_reason = why; return 0; }
  return 1;
}
void phil_runtime_select_begin_policy_reject(void *transport, u8 rejection_reason) { MUST(TRANSPORT_IS_OURS(transport) && rejection_reason != 0 && rejection_reason == S->policy_reason, 15); if (S->violation) return; S->outcome = POLICY_REJECTED; S->reason = rejection_reason; LOG("Phil: REJECTED by policy before any payload was read"); }
void phil_runtime_select_begin_policy_proceed(void *transport) { MUST(TRANSPORT_IS_OURS(transport) && S->policy_reason == 0 && S->begin_frame.stage == 2, 12); LOG("Phil: policy passed, proceed"); }

bool phil_runtime_receive_payload_cancel(void *transport) {
  struct transport *t = &S->transport;
  MUST(TRANSPORT_IS_OURS(transport), 12);
  if (t->cursor < t->available && t->bytes[t->cursor] == 1) { t->cursor += 1; return 1; }
  if (t->cursor < t->available) t->cursor += 1;
  S->outcome = CANCELLED;
  LOG("Phil: the client cancelled");
  return 0;
}

// Phil declares this one as returning the LLVM aggregate { i8, ptr }. C compilers do not agree
// across targets on how a struct comes back, so for Solana it is written in LLVM (shim.ll) and
// calls the helper below. The native ABI check builds the C version, which Phil's checker reads.
u8 phil_draw_receive_exact(void *transport, u64 length, void **payload_out) {
  struct transport *t = &S->transport;
  u64 left = t->available - t->cursor;
  u64 taken = length <= left ? length : left;
  MUST(TRANSPORT_IS_OURS(transport) && length == S->begin.length && !S->payload_taken, 16);
  S->payload_taken = 1;
  S->payload.bytes = t->bytes + t->cursor; S->payload.length = taken; S->payload.held = 1;
  t->cursor += taken;
  *payload_out = &S->payload;
  if (length > left) { S->outcome = EARLY_EOF; LOG("Phil: fewer bytes arrived than Begin declared"); return 0; }
  LOG("Phil: payload received, exactly the declared length");
  return FAULT(3) ? 2 : 1;
}
#ifdef PHIL_DRAW_C_STRUCT_RETURN
struct phil_exact_receive_result { u8 status; void *payload; };
struct phil_exact_receive_result phil_runtime_receive_exact_u64(void *transport, u64 length) {
  struct phil_exact_receive_result r;
  r.status = phil_draw_receive_exact(transport, length, &r.payload);
  return r;
}
#endif

bool phil_runtime_digest_validate(void *begin_record, void *payload) {
  struct begin *b = begin_record;
  struct payload *p = payload;
  struct sol_bytes part = { p->bytes, p->length };
  MUST(b == &S->begin && p == &S->payload && p->held, 18);
  if (S->violation) return 0;
  sol_sha256(&part, 1, S->computed);
  if (!same(S->computed, b->digest, 32)) return 0;
  S->digest_ok = 1;
  LOG("Phil: SHA-256 matches the declared digest");
  return 1;
}
void phil_buffer_release(void *payload) { MUST(payload == &S->payload && S->payload.held, 19); S->payload.held = 0; }


u8 phil_runtime_store_with_error(void *payload, void **upload_id_out, void **storage_error_out) {
  struct payload *p = payload;
  u8 why;
  *storage_error_out = &S->storage_reason;
  MUST(payload == &S->payload && p->held && S->digest_ok && !S->stored, 20);       /* carried out once, and only after its digest was checked */
  if (S->violation) return 0;
  p->held = 0;                                                                     /* storing consumes the payload, whatever the result */
  if (FAULT(4)) return 2;
  why = 0;                                                                         /* a note is kept nowhere: the verdict is the product */
  if (why) { S->storage_reason = why; return 0; }
  S->stored = 1;
  *upload_id_out = &S->upload_id;
  return 1;
}
void phil_runtime_fail_storage(void *transport, void *storage_error) { MUST(TRANSPORT_IS_OURS(transport) && storage_error == &S->storage_reason && !S->stored, 21); if (S->violation) return; S->outcome = STORAGE_FAILED; S->reason = S->storage_reason; LOG("Phil: the upload was valid but could not be carried out"); }
void phil_runtime_select_accepted(void *transport, void *upload_id) { MUST(TRANSPORT_IS_OURS(transport) && S->stored && upload_id == (void *)&S->upload_id, 22); if (S->violation) return; S->outcome = ACCEPTED; LOG("Phil: ACCEPTED"); }
void phil_runtime_select_rejected(void *transport, u8 reason) { MUST(TRANSPORT_IS_OURS(transport) && reason == 1 && !S->digest_ok && S->payload_taken && !S->payload.held, 23); if (S->violation) return; S->outcome = REJECTED; S->reason = reason; LOG("Phil: REJECTED, the bytes do not match the declared digest"); }

// ---- the client half of Phil's interface. The client runs in the sender's browser, not here;
// ---- these exist so that every symbol Phil's module names is defined, and do nothing.
void *phil_runtime_supported_versions(void) { return NULL; }
u64 phil_runtime_payload_length(void *payload_owner) { (void)payload_owner; return 0; }
void *phil_runtime_payload_kind(void *payload_owner) { (void)payload_owner; return NULL; }
void *phil_runtime_sha256(void *payload_owner) { (void)payload_owner; return NULL; }
void phil_runtime_send_hello(void *transport, void *versions) { (void)transport; (void)versions; }
void phil_runtime_send_begin_sha256(void *transport, u64 length, void *kind, void *digest) { (void)transport; (void)length; (void)kind; (void)digest; }
bool phil_runtime_refine_selected_version_with_set(void *transport, void *versions, u16 selected) { (void)transport; (void)versions; (void)selected; return 0; }
bool phil_runtime_receive_version_choice(void *transport, u16 *selected_version_out) { (void)transport; (void)selected_version_out; return 0; }
bool phil_runtime_receive_begin_policy_choice(void *transport, u8 *rejection_reason_out) { (void)transport; (void)rejection_reason_out; return 0; }
void phil_runtime_select_payload_cancel(void *transport, u8 choice) { (void)transport; (void)choice; }
void phil_runtime_send_exact(void *transport, void *payload_owner) { (void)transport; (void)payload_owner; }
bool phil_runtime_receive_final_response(void *transport, void **upload_id_out) { (void)transport; (void)upload_id_out; return 0; }
void phil_runtime_record_upload_id(void *upload_id) { (void)upload_id; }
void phil_call_should_cancel_upload(void) {}
bool phil_branch_condition(void) { return 0; }
void phil_cleanup(void) {}

// ================= one run, the same on every chain =================
static u64 run(const u8 *ix, u64 ix_len) {
  if (ix_len < 1) return 102;
  S->op = ix[0];
  if (S->op != OP_NOTE) return 103;
  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  if (UploadServer(NULL, S->supported, &S->transport) != 0) violate(30);                 /* it returns 0 on every path */
  if (S->hello_frame.stage == 1 || S->begin_frame.stage == 1) violate(31);                /* a frame left pending */
  if (S->payload.held) violate(32);                                                       /* a payload neither stored nor released */
  if (S->violation) { LOG("Phil runtime: the server broke one of the protocol's ownership rules; refusing"); return 2000u + S->violation; }
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil chains: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED is a refusal. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}

#ifdef __riscv
// ================= RISC-V: the interpreter puts the upload at a0 with its length in a1 =================
void start_c(const u8 *ix, u64 ix_len) { host(0, run(ix, ix_len), 0, 0); for (;;) {} }
__asm__(".section .text.start\n.globl _start\n_start:\n  j start_c\n");
#else
// ================= Solana's entry point =================
u64 entrypoint(const u8 *input) {
  const u8 *in = input;
  u64 n = le64(in); in += 8;
  for (u64 i = 0; i < n; i++) {                 /* no account is used; step over any that were passed */
    if (in[0] != 0xff) { in += 8; continue; }
    in += 8 + 32 + 32 + 8;
    { u64 data_len = le64(in); in += 8 + data_len + 10240; }
    in += (8 - ((u64)in & 7)) & 7;
    in += 8;
  }
  { u64 ix_len = le64(in); return run(in + 8, ix_len); }
}
#endif
