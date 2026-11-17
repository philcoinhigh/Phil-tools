// A Solana runtime for Phil's upload server, used as a vault that is not opened by an
// elliptic-curve signature.
//
// An ordinary Solana wallet is controlled by an Ed25519 key. A large enough quantum computer could
// work that key out from the public key every transaction shows. This vault is controlled by a
// hash-based one-time signature instead (Winternitz, one byte per chain, SHA-256 kept to 192 bits),
// whose only assumption is that the hash is hard to run backwards. The construction is the
// well-known one, as in Dean Little's Solana Winternitz Vault.
//
// A one-time key must sign exactly once: two signatures from one key let anyone forge others. So the
// vault holds the fingerprint of one key; a spend is signed with that key, names the fingerprint of
// the next key, and the vault moves to it in the same instruction. The used key can never be
// accepted again.
//
//   OPEN    stores the first key's fingerprint and, if the owner wants them, a waiting time for
//           every withdrawal and the fingerprint of a second, "guard" key kept offline.
//   SPEND   if the one-time signature checks, rotates the key and pays an amount of SOL or of any
//           token to a recipient. Nobody has to sign the transaction but its fee payer, who gains
//           no say over the funds: the signature covers the vault, the recipient, the coin, the
//           amount and the next key. In a vault with a waiting time the payment is not made yet:
//           it is recorded, and can be completed once the time has passed.
//   FINISH  completes a recorded payment after its waiting time. Anyone may send it; it can only
//           pay what was signed, to whom it was signed.
//   CANCEL  signed by the guard key: drops any recorded payment and replaces the vault's key (and
//           the guard key, which is also one-time). This is the answer to a stolen phrase.
//
// Tokens sit in token accounts whose authority is an address derived from the vault's, which only
// this program can sign for.
//
// All four are uploads through `UploadServer`, the function Phil's LLVM backend emits (see
// giveaway/runtime.c for how that interface is met on Solana). Phil's server checks the upload's
// handshake, its policy and that the bytes match their declared SHA-256; the signature check, the
// payment and the rotation below are ours and are not Phil.
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long u64;
typedef long i64;
#define bool _Bool
#define NULL ((void *)0)

// Provided by Solana's virtual machine (and by the native harness in tests).
extern void sol_log_(const char *message, u64 length);
extern void sol_log_64_(u64 a, u64 b, u64 c, u64 d, u64 e);
struct sol_bytes { const u8 *addr; u64 len; };
extern u64 sol_sha256(const struct sol_bytes *parts, u64 count, u8 *out);
struct sol_clock { u64 slot; i64 epoch_start; u64 epoch; u64 leader_epoch; i64 unix_time; };
extern u64 sol_get_clock_sysvar(struct sol_clock *out);
struct sol_account_info { const u8 *key; u64 *lamports; u64 data_len; u8 *data; const u8 *owner; u64 rent_epoch; bool is_signer; bool is_writable; bool executable; };
// Calling another program. These layouts are Solana's C interface.
struct sol_meta { const u8 *pubkey; bool is_writable; bool is_signer; };
struct sol_instruction { const u8 *program_id; struct sol_meta *accounts; u64 account_len; u8 *data; u64 data_len; };
struct sol_seed { const u8 *addr; u64 len; };
struct sol_seeds { const struct sol_seed *addr; u64 len; };
extern u64 sol_invoke_signed_c(const struct sol_instruction *instruction, const struct sol_account_info *infos, int info_count, const struct sol_seeds *signer_seeds, int seed_count);

extern int UploadServer(void *policy_context, void *supported_versions, void *transport);

#define LOG(text) sol_log_(text, sizeof(text) - 1)

// ---- small helpers (the compiler may also call these by name) ----
void *memcpy(void *dst, const void *src, u64 n) { u8 *d = dst; const u8 *s = src; while (n--) *d++ = *s++; return dst; }
void *memset(void *dst, int c, u64 n) { u8 *d = dst; while (n--) *d++ = (u8)c; return dst; }
int memcmp(const void *a, const void *b, u64 n) { const u8 *x = a, *y = b; while (n--) { if (*x != *y) return *x < *y ? -1 : 1; x++; y++; } return 0; }
static bool same(const u8 *a, const u8 *b, u64 n) { u8 diff = 0; while (n--) diff |= (u8)(*a++ ^ *b++); return diff == 0; }
static u16 be16(const u8 *p) { return (u16)((p[0] << 8) | p[1]); }
static u64 be64(const u8 *p) { u64 v = 0; for (int i = 0; i < 8; i++) v = (v << 8) | p[i]; return v; }
static u64 le64(const u8 *p) { u64 v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | p[i]; return v; }
static void put64(u8 *p, u64 v) { for (int i = 0; i < 8; i++) { p[i] = (u8)v; v >>= 8; } }

// ---- instructions, outcomes, limits ----
enum { OP_OPEN = 1, OP_SPEND = 2, OP_FINISH = 3, OP_CANCEL = 4 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2, POLICY_BAD_VAULT = 3, POLICY_WRONG_STATE = 4, POLICY_BAD_RECIPIENT = 5 };
enum { STORE_BAD_RECORD = 1, STORE_NO_KEY = 2, STORE_NOTHING_TO_SEND = 3, STORE_TOO_MUCH = 4, STORE_NEEDS_NEXT_KEY = 5, STORE_BAD_SIGNATURE = 6,
       STORE_TOO_EARLY = 7, STORE_WRONG_ACCOUNTS = 8, STORE_NO_GUARD = 9, STORE_BAD_TERMS = 10, STORE_TOKEN_FAILED = 11 };
#define MAX_PAYLOAD 720u
static const char KIND_OPEN[] = "phil-qvault/open";
static const char KIND_SPEND[] = "phil-qvault/spend";
static const char KIND_FINISH[] = "phil-qvault/finish";
static const char KIND_CANCEL[] = "phil-qvault/cancel";
#define MAX_DELAY (30u * 86400u)
static const u8 TOKEN_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93, 0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac, 0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91, 0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9 };
static const u8 TOKEN_2022_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde, 0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda, 0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27, 0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc };

// ---- the one-time signature ----
#define N 24u              /* bytes kept of each hash in a chain */
#define CHAINS 26u         /* 24 carry the message, 2 carry its checksum */
#define SIG_BYTES (CHAINS * N)
#define SPEND_BYTES (5u + 8u + 8u + 32u + SIG_BYTES)
#define OPEN_BYTES (5u + 32u + 1u + 8u + 32u)
#define CANCEL_BYTES (5u + 8u + 32u + 32u + SIG_BYTES)

// ---- the vault account: 320 bytes ----
enum { EMPTY = 0, OPEN = 1, CLOSED = 2 };
#define QVAULT_SIZE 320u
#define Q_MAGIC 0          /* "PHILQVLT" */
#define Q_STATE 8
#define Q_COUNTER 16       /* u64: how many keys have been used; also the number of the current key */
#define Q_RESERVE 24       /* u64: lamports that are the account's rent and never part of the balance */
#define Q_ROOT 32          /* the current one-time key's fingerprint */
#define Q_OPENED_TIME 64
#define Q_LAST_TIME 72
#define Q_TOTAL_SPENT 80
#define Q_LAST_RECIPIENT 88
#define Q_DELAY 120            /* u64: seconds every withdrawal waits; 0 pays at once */
#define Q_GUARD_ROOT 128       /* the guard key's fingerprint; all zero if the vault has none */
#define Q_GUARD_COUNTER 160    /* u64: how many guard keys have been used */
#define Q_PENDING_READY 168    /* u64: when the recorded payment may be completed; 0 if none is recorded */
#define Q_PENDING_AMOUNT 176
#define Q_PENDING_RECIPIENT 184
#define Q_PENDING_MINT 216     /* all zero for SOL */
#define Q_LAST_MINT 248
#define Q_CANCELS 280          /* u64 */
#define Q_BUMP 288             /* of the address that is the authority of the vault's token accounts */

// ---- working state, in the heap region ----
struct transport { const u8 *bytes; u64 available; u64 cursor; };
struct frame { const u8 *bytes; u64 length; u8 tag; u8 problem; u8 stage; };   /* stage: 0 none, 1 pending, 2 committed, 3 destroyed */
struct hello { const u8 *versions; u16 count; };
struct begin { u64 length; const u8 *kind; const u8 *digest; u8 kind_len; };
struct payload { const u8 *bytes; u64 length; u8 held; };
struct state {
  struct sol_account_info accounts[8];
  u64 account_count;
  const u8 *program_id;
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
  u8 ends[CHAINS * N];                        /* the chain ends a signature leads to */
};
#define S ((struct state *)0x300000000UL)

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
  struct sol_account_info *vault = &S->accounts[0];
  const char *kind = S->op == OP_OPEN ? KIND_OPEN : S->op == OP_SPEND ? KIND_SPEND : S->op == OP_FINISH ? KIND_FINISH : KIND_CANCEL;
  u64 kind_len = S->op == OP_OPEN ? sizeof(KIND_OPEN) - 1 : S->op == OP_SPEND ? sizeof(KIND_SPEND) - 1 : S->op == OP_FINISH ? sizeof(KIND_FINISH) - 1 : sizeof(KIND_CANCEL) - 1;
  bool waiting;
  u8 why = 0;
  (void)policy_context;
  MUST(begin_record == &S->begin && S->begin_frame.stage == 2, 14);
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != kind_len || !same(b->kind, (const u8 *)kind, kind_len)) why = POLICY_WRONG_KIND;
  else if (S->account_count < 1 || vault->data_len < QVAULT_SIZE || !vault->is_writable || !same(vault->owner, S->program_id, 32)) why = POLICY_BAD_VAULT;
  else if (vault->data[Q_STATE] != (S->op == OP_OPEN ? EMPTY : OPEN)) why = POLICY_WRONG_STATE;
  else if ((waiting = le64(vault->data + Q_PENDING_READY) != 0), S->op == OP_SPEND && waiting) why = POLICY_WRONG_STATE;       /* one recorded payment at a time */
  else if (S->op == OP_FINISH && !waiting) why = POLICY_WRONG_STATE;
  else if ((S->op == OP_SPEND || S->op == OP_FINISH) && (S->account_count < 2 || same(S->accounts[1].key, vault->key, 32))) why = POLICY_BAD_RECIPIENT;
  else if ((S->op == OP_FINISH || (S->op == OP_SPEND && le64(vault->data + Q_DELAY) == 0)) && !S->accounts[1].is_writable) why = POLICY_BAD_RECIPIENT;
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


// ---- what each accepted upload does ----
static i64 now(void) { struct sol_clock clock; sol_get_clock_sysvar(&clock); return clock.unix_time; }
static bool all_zero(const u8 *p, u64 n) { while (n--) if (*p++) return 0; return 1; }

// OPEN. What is uploaded: "QVLT2", the first key's 32-byte fingerprint, the bump of the vault's token
// authority, the waiting time in seconds (u64), and the guard key's fingerprint (all zero for none).
// Accounts: the vault.
static u8 open_vault(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0];
  const u8 *r = p->bytes;
  u8 *d = vault->data;
  u64 delay;
  if (p->length != OPEN_BYTES || !same(r, (const u8 *)"QVLT2", 5)) return STORE_BAD_RECORD;
  if (all_zero(r + 5, 32)) return STORE_NO_KEY;
  delay = le64(r + 38);
  if (delay > MAX_DELAY) return STORE_BAD_TERMS;
  if (delay != 0 && all_zero(r + 46, 32)) return STORE_BAD_TERMS;      /* a waiting time is only useful with a key that can cancel */
  memset(d, 0, QVAULT_SIZE);
  memcpy(d + Q_MAGIC, "PHILQVLT", 8);
  d[Q_STATE] = OPEN;
  put64(d + Q_RESERVE, *vault->lamports);            /* what the account holds now is its rent, never its balance */
  memcpy(d + Q_ROOT, r + 5, 32);
  d[Q_BUMP] = r[37];
  put64(d + Q_DELAY, delay);
  memcpy(d + Q_GUARD_ROOT, r + 46, 32);
  put64(d + Q_OPENED_TIME, (u64)now());
  LOG("Phil qvault: OPENED. The vault answers only to a hash-based one-time key");
  return 0;
}

// One step along chain i, from position j: SHA-256("QF1", i, j, value), kept to N bytes.
static void chain_step(u8 i, u8 j, u8 *value) {
  u8 in[5 + N], out[32];
  struct sol_bytes part = { in, 5 + N };
  in[0] = 'Q'; in[1] = 'F'; in[2] = '1'; in[3] = i; in[4] = j;
  memcpy(in + 5, value, N);
  sol_sha256(&part, 1, out);
  memcpy(value, out, N);
}
// Does this one-time signature of this digest lead to this key's fingerprint?
static bool signature_checks(const u8 *digest, const u8 *sig, const u8 *fingerprint) {
  u8 root[32], pos[CHAINS];
  u64 check = 0;
  // The chain positions: the digest's first 24 bytes, then a checksum that falls whenever any of them rises,
  // so nobody can turn this signature into one for another message by hashing forward.
  for (u64 i = 0; i < N; i++) { pos[i] = digest[i]; check += 255u - digest[i]; }
  pos[N] = (u8)(check >> 8); pos[N + 1] = (u8)check;
  // Walk every chain from where the signature stands to its end.
  memcpy(S->ends, sig, SIG_BYTES);
  for (u64 i = 0; i < CHAINS; i++)
    for (u64 j = pos[i]; j < 255; j++) chain_step((u8)i, (u8)j, S->ends + i * N);
  {
    struct sol_bytes parts[2] = { { (const u8 *)"QK1", 3 }, { S->ends, SIG_BYTES } };
    sol_sha256(parts, 2, root);
  }
  return same(root, fingerprint, 32);
}

// Pays out of the vault: lamports directly, or a token from the vault's token account.
// Token accounts: [2] the vault's token account, [3] the coin, [4] the vault's token authority, [5] the token program.
// Token instruction 12 is TransferChecked: [source, mint, destination, authority], then amount and decimals.
static u8 pay(bool token, u64 amount) {
  struct sol_account_info *vault = &S->accounts[0], *to = &S->accounts[1];
  u8 *d = vault->data;
  if (!token) {
    if (amount > *vault->lamports - le64(d + Q_RESERVE)) return STORE_TOO_MUCH;
    *vault->lamports -= amount; *to->lamports += amount;
    put64(d + Q_TOTAL_SPENT, le64(d + Q_TOTAL_SPENT) + amount);
    memset(d + Q_LAST_MINT, 0, 32);
  } else {
    struct sol_account_info *from = &S->accounts[2], *mint = &S->accounts[3], *authority = &S->accounts[4], *program = &S->accounts[5];
    u8 data[10], bump = d[Q_BUMP];
    struct sol_meta metas[4] = { { from->key, 1, 0 }, { mint->key, 0, 0 }, { to->key, 1, 0 }, { authority->key, 0, 1 } };
    struct sol_instruction ix = { program->key, metas, 4, data, 10 };
    struct sol_seed seeds[3] = { { (const u8 *)"qv", 2 }, { vault->key, 32 }, { &bump, 1 } };
    struct sol_seeds signer = { seeds, 3 };
    struct sol_account_info infos[5];
    if (S->account_count < 6) return STORE_WRONG_ACCOUNTS;
    if (!same(program->key, TOKEN_PROGRAM, 32) && !same(program->key, TOKEN_2022_PROGRAM, 32)) return STORE_WRONG_ACCOUNTS;
    if (!same(mint->owner, program->key, 32) || mint->data_len < 45) return STORE_WRONG_ACCOUNTS;
    data[0] = 12; put64(data + 1, amount); data[9] = mint->data[44];
    infos[0] = *from; infos[1] = *mint; infos[2] = *to; infos[3] = *authority; infos[4] = *program;
    if (sol_invoke_signed_c(&ix, infos, 5, &signer, 1) != 0) return STORE_TOKEN_FAILED;
    memcpy(d + Q_LAST_MINT, mint->key, 32);
  }
  put64(d + Q_LAST_TIME, (u64)now());
  memcpy(d + Q_LAST_RECIPIENT, to->key, 32);
  return 0;
}

// SPEND. What is uploaded: "QSPD1", amount u64, salt u64, the next key's fingerprint (32 bytes),
// the signature (26 chain values of 24 bytes).
// Accounts, paying at once:   the vault, the recipient                                  (SOL)
//                             the vault, the recipient's token account, then pay()'s four   (a token)
// Accounts, with a waiting time: the vault, the recipient, and for a token the coin.
static u8 spend(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0], *to = &S->accounts[1];
  const u8 *r = p->bytes, *next = r + 21, *sig = r + 53;
  u8 *d = vault->data;
  u8 digest[32], counter[8], sol[32];
  u64 amount, delay = le64(d + Q_DELAY);
  bool token = S->account_count > 2;
  const u8 *mint = token ? S->accounts[delay ? 2 : 3].key : sol;
  bool closing;
  if (p->length != SPEND_BYTES || !same(r, (const u8 *)"QSPD1", 5)) return STORE_BAD_RECORD;
  if (token && !delay && S->account_count < 6) return STORE_WRONG_ACCOUNTS;
  memset(sol, 0, 32);
  if (all_zero(mint, 32)) token = 0;
  amount = le64(r + 5);
  closing = all_zero(next, 32);
  if (amount == 0) return STORE_NOTHING_TO_SEND;
  if (!token && amount > *vault->lamports - le64(d + Q_RESERVE)) return STORE_TOO_MUCH;
  // While anything is left in the vault it must have a next key. Only a spend that pays out all its SOL at
  // once may end it. (Tokens are not counted: empty the token accounts first.)
  if (closing && (token || delay || amount != *vault->lamports - le64(d + Q_RESERVE))) return STORE_NEEDS_NEXT_KEY;
  // What the signature covers: this vault, this recipient, this coin, this amount, the next key, which spend this is, the salt.
  {
    struct sol_bytes parts[8] = { { (const u8 *)"QM2", 3 }, { vault->key, 32 }, { to->key, 32 }, { mint, 32 }, { r + 5, 8 }, { next, 32 }, { counter, 8 }, { r + 13, 8 } };
    memcpy(counter, d + Q_COUNTER, 8);
    sol_sha256(parts, 8, digest);
  }
  if (!signature_checks(digest, sig, d + Q_ROOT)) return STORE_BAD_SIGNATURE;
  // The key is spent. Move to the next key in the same step, and pay or record the payment.
  if (delay) {
    put64(d + Q_PENDING_READY, (u64)now() + delay);
    put64(d + Q_PENDING_AMOUNT, amount);
    memcpy(d + Q_PENDING_RECIPIENT, to->key, 32);
    memcpy(d + Q_PENDING_MINT, mint, 32);
  } else {
    u8 why = pay(token, amount);
    if (why) return why;
  }
  memcpy(d + Q_ROOT, next, 32);
  put64(d + Q_COUNTER, le64(d + Q_COUNTER) + 1);
  if (delay) { LOG("Phil qvault: SIGNED and RECORDED. The one-time key is used up; the payment waits out the vault's delay"); return 0; }
  if (closing) { d[Q_STATE] = CLOSED; LOG("Phil qvault: SPENT and CLOSED. The vault was emptied and has no further key"); }
  else LOG("Phil qvault: SPENT. The one-time key is used up and the vault has moved to the next. Amount paid:");
  sol_log_64_(0, 0, 0, 0, amount);
  return 0;
}

// FINISH. What is uploaded: "QFIN1". Accounts: the vault, the recorded recipient, and for a token pay()'s four.
// Needs no signature: it can only do what the recorded payment says, and only once its time has come.
static u8 finish(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0], *to = &S->accounts[1];
  u8 *d = vault->data;
  bool token = !all_zero(d + Q_PENDING_MINT, 32);
  u64 amount = le64(d + Q_PENDING_AMOUNT);
  u8 why;
  if (p->length != 5 || !same(p->bytes, (const u8 *)"QFIN1", 5)) return STORE_BAD_RECORD;
  if ((u64)now() < le64(d + Q_PENDING_READY)) return STORE_TOO_EARLY;
  if (!same(to->key, d + Q_PENDING_RECIPIENT, 32)) return STORE_WRONG_ACCOUNTS;
  if (token && (S->account_count < 6 || !same(S->accounts[3].key, d + Q_PENDING_MINT, 32))) return STORE_WRONG_ACCOUNTS;
  why = pay(token, amount);
  if (why) return why;
  memset(d + Q_PENDING_READY, 0, 8 + 8 + 32 + 32);
  LOG("Phil qvault: PAID. The recorded payment waited out its delay. Amount paid:");
  sol_log_64_(0, 0, 0, 0, amount);
  return 0;
}

// CANCEL. What is uploaded: "QCNL1", salt u64, a new vault key's fingerprint, a new guard key's fingerprint,
// and the guard key's signature over all of that. Accounts: the vault.
// Whoever stole the vault's phrase knows every key that follows from it, so the vault gets a key from a new phrase.
static u8 cancel(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0];
  const u8 *r = p->bytes, *key = r + 13, *guard = r + 45, *sig = r + 77;
  u8 *d = vault->data;
  u8 digest[32], counter[8];
  if (p->length != CANCEL_BYTES || !same(r, (const u8 *)"QCNL1", 5)) return STORE_BAD_RECORD;
  if (all_zero(d + Q_GUARD_ROOT, 32)) return STORE_NO_GUARD;
  if (all_zero(key, 32) || all_zero(guard, 32)) return STORE_NO_KEY;
  {
    struct sol_bytes parts[6] = { { (const u8 *)"QC1", 3 }, { vault->key, 32 }, { key, 32 }, { guard, 32 }, { counter, 8 }, { r + 5, 8 } };
    memcpy(counter, d + Q_GUARD_COUNTER, 8);
    sol_sha256(parts, 6, digest);
  }
  if (!signature_checks(digest, sig, d + Q_GUARD_ROOT)) return STORE_BAD_SIGNATURE;
  memset(d + Q_PENDING_READY, 0, 8 + 8 + 32 + 32);
  memcpy(d + Q_ROOT, key, 32);
  memcpy(d + Q_GUARD_ROOT, guard, 32);
  put64(d + Q_GUARD_COUNTER, le64(d + Q_GUARD_COUNTER) + 1);
  put64(d + Q_CANCELS, le64(d + Q_CANCELS) + 1);
  LOG("Phil qvault: CANCELLED by the guard key. Nothing is waiting, and the vault has a new key");
  return 0;
}

u8 phil_runtime_store_with_error(void *payload, void **upload_id_out, void **storage_error_out) {
  struct payload *p = payload;
  u8 why;
  *storage_error_out = &S->storage_reason;
  MUST(payload == &S->payload && p->held && S->digest_ok && !S->stored, 20);       /* carried out once, and only after its digest was checked */
  if (S->violation) return 0;
  p->held = 0;                                                                     /* storing consumes the payload, whatever the result */
  if (FAULT(4)) return 2;
  why = S->op == OP_OPEN ? open_vault(p) : S->op == OP_SPEND ? spend(p) : S->op == OP_FINISH ? finish(p) : cancel(p);
  if (why) { S->storage_reason = why; return 0; }
  S->stored = 1;
  *upload_id_out = (void *)S->accounts[0].key;
  return 1;
}
void phil_runtime_fail_storage(void *transport, void *storage_error) { MUST(TRANSPORT_IS_OURS(transport) && storage_error == &S->storage_reason && !S->stored, 21); if (S->violation) return; S->outcome = STORAGE_FAILED; S->reason = S->storage_reason; LOG("Phil: the upload was valid but could not be carried out"); }
void phil_runtime_select_accepted(void *transport, void *upload_id) { MUST(TRANSPORT_IS_OURS(transport) && S->stored && upload_id == (void *)S->accounts[0].key, 22); if (S->violation) return; S->outcome = ACCEPTED; LOG("Phil: ACCEPTED"); }
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

// ================= Solana's entry point =================
u64 entrypoint(const u8 *input) {
  const u8 *in = input;
  const u8 *ix; u64 ix_len;
  u64 n = le64(in); in += 8;
  if (n > 8) return 101;
  S->account_count = n;
  for (u64 i = 0; i < n; i++) {
    struct sol_account_info *a = &S->accounts[i];
    if (in[0] != 0xff) { *a = S->accounts[in[0]]; in += 8; continue; }
    a->is_signer = in[1]; a->is_writable = in[2]; a->executable = in[3];
    in += 8;
    a->key = in; in += 32;
    a->owner = in; in += 32;
    a->lamports = (u64 *)in; in += 8;
    a->data_len = le64(in); in += 8;
    a->data = (u8 *)in;
    in += a->data_len + 10240;                  /* data, then the room Solana reserves for growth */
    in += (8 - ((u64)in & 7)) & 7;
    a->rent_epoch = le64(in); in += 8;
  }
  ix_len = le64(in); in += 8; ix = in; in += ix_len;
  S->program_id = in;
  if (ix_len < 1) return 102;
  S->op = ix[0];
  if (S->op < OP_OPEN || S->op > OP_CANCEL) return 103;

  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  if (UploadServer(NULL, S->supported, &S->transport) != 0) violate(30);                 /* it returns 0 on every path */
  if (S->hello_frame.stage == 1 || S->begin_frame.stage == 1) violate(31);                /* a frame left pending */
  if (S->payload.held) violate(32);                                                       /* a payload neither stored nor released */
  if (S->violation) { LOG("Phil runtime: the server broke one of the protocol's ownership rules; refusing"); return 2000u + S->violation; }
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil qvault: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED fails the transaction, so the vault does not change. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}
