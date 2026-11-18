// Clip Bounties: a prize locked on Solana for the best clip, with entries sealed by Phil's upload server.
//
// `UploadServer` is the function Phil's LLVM backend emits; this file is the runtime it calls on
// Solana (see giveaway/runtime.c for how that works). Two instructions are uploads that Phil's
// server accepts or refuses:
//
//   POST    a sponsor posts a challenge: its text, a deadline and a prize. The prize must already be
//           in the bounty (SOL in the bounty's account, or a token in the token account that only
//           this program can sign for), so a challenge can never be posted without its prize.
//   ENTER   anyone enters with a link to their clip. The entry gets a number and a time.
//
// Four are not Phil. They move the prize, and it moves exactly once:
//
//   AWARD   the sponsor picks an entry; the prize is paid to whoever made it.
//   ARM     if the sponsor has not picked by the deadline plus the grace time, anyone may start a
//           draw: it names a block a little in the future.
//   DRAW    once that block exists, its hash picks an entry number. Nobody chose the hash.
//   CLAIM   pays the prize to the entry with that number. Anyone may send it.
//   REFUND  only if the deadline passed with no entries at all: the prize goes back to the sponsor.
//
// So a posted prize always leaves the bounty for an entrant, unless nobody entered.
// Phil's server checks each upload's handshake, policy and SHA-256. Everything else here is ours,
// is not Phil, and is not audited.
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
static u32 le32(const u8 *p) { return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24); }
static void put32(u8 *p, u32 v) { for (int i = 0; i < 4; i++) { p[i] = (u8)v; v >>= 8; } }
static u64 le64(const u8 *p) { u64 v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | p[i]; return v; }
static void put64(u8 *p, u64 v) { for (int i = 0; i < 8; i++) { p[i] = (u8)v; v >>= 8; } }

// ---- instructions, outcomes, limits ----
enum { OP_POST = 1, OP_ENTER = 2, OP_AWARD = 3, OP_ARM = 4, OP_DRAW = 5, OP_CLAIM = 6, OP_REFUND = 7 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2, POLICY_BAD_ACCOUNT = 3, POLICY_WRONG_STATE = 4 };
enum { STORE_BAD_RECORD = 1, STORE_BAD_TERMS = 2, STORE_NOT_SIGNED = 3, STORE_NOT_FUNDED = 4, STORE_CLOSED = 5, STORE_BAD_ENTRY_ACCOUNT = 6, STORE_FULL = 7 };
#define MAX_PAYLOAD 320u
#define MAX_TEXT 280u
#define MAX_LINK 220u
#define MAX_ENTRIES 10000u
#define MAX_AHEAD (90u * 86400u)       /* a deadline at most 90 days away */
#define MAX_GRACE (30u * 86400u)
#define DRAW_AHEAD 20u                 /* the draw's block is this many slots after ARM */
#define DRAW_WINDOW 450u               /* Solana keeps about 512 recent block hashes */
static const char KIND_POST[] = "phil-bounty/post";
static const char KIND_ENTER[] = "phil-bounty/enter";
static const u8 TOKEN_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93, 0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac, 0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91, 0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9 };
static const u8 TOKEN_2022_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde, 0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda, 0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27, 0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc };
static const u8 SLOT_HASHES_ID[32] = { 0x06, 0xa7, 0xd5, 0x17, 0x19, 0x2f, 0x0a, 0xaf, 0xc6, 0xf2, 0x65, 0xe3, 0xfb, 0x77, 0xcc, 0x7a, 0xda, 0x82, 0xc5, 0x29, 0xd0, 0xbe, 0x3b, 0x13, 0x6e, 0x2d, 0x00, 0x55, 0x20, 0x00, 0x00, 0x00 };

// ---- the bounty account: 512 bytes ----
enum { EMPTY = 0, OPEN = 1, PAID = 2, REFUNDED = 3, DRAWN = 4 };
#define BOUNTY_SIZE 512u
#define B_MAGIC 0          /* "PHILBNTY" */
#define B_STATE 8
#define B_BUMP 9           /* of the address that is the authority of the bounty's token account */
#define B_HOW 10           /* how the winner was chosen: 1 the sponsor picked, 2 a block hash drew */
#define B_SPONSOR 16
#define B_MINT 48          /* all zero when the prize is SOL */
#define B_PRIZE 80         /* u64 */
#define B_RESERVE 88       /* u64: lamports that are the account's rent, never part of the prize */
#define B_DEADLINE 96      /* i64: no entries after this time */
#define B_GRACE 104        /* u64: seconds after the deadline before anyone may start a draw */
#define B_COUNT 112        /* u32: entries so far; also the next entry's number */
#define B_POSTED 120
#define B_DRAW_SLOT 128    /* u64: the block whose hash will draw; 0 until ARM */
#define B_WINNER_INDEX 136 /* u32 */
#define B_WINNER 144       /* the wallet that was paid */
#define B_PAID_TIME 176
#define B_HASH_SLOT 184
#define B_SLOT_HASH 192
#define B_TEXT_LEN 224     /* u16 */
#define B_TEXT 226
// ---- an entry account: 320 bytes ----
#define ENTRY_SIZE 320u
#define E_MAGIC 0          /* "PHILBENT" */
#define E_BOUNTY 8
#define E_ENTRANT 40
#define E_INDEX 72         /* u32 */
#define E_TIME 80
#define E_LINK_LEN 88      /* u16 */
#define E_LINK 90

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
  struct sol_account_info *bounty = &S->accounts[0];
  const char *kind = S->op == OP_POST ? KIND_POST : KIND_ENTER;
  u64 kind_len = S->op == OP_POST ? sizeof(KIND_POST) - 1 : sizeof(KIND_ENTER) - 1;
  u8 why = 0;
  (void)policy_context;
  MUST(begin_record == &S->begin && S->begin_frame.stage == 2, 14);
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != kind_len || !same(b->kind, (const u8 *)kind, kind_len)) why = POLICY_WRONG_KIND;
  else if (S->account_count < 1 || !bounty->is_writable || bounty->data_len != BOUNTY_SIZE || !same(bounty->owner, S->program_id, 32)) why = POLICY_BAD_ACCOUNT;
  else if (bounty->data[B_STATE] != (S->op == OP_POST ? EMPTY : OPEN)) why = POLICY_WRONG_STATE;
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


// ---- shared: the token authority, who receives, and the one payment ----
static i64 now(void) { struct sol_clock clock; sol_get_clock_sysvar(&clock); return clock.unix_time; }
static bool all_zero(const u8 *p, u64 n) { while (n--) if (*p++) return 0; return 1; }
static bool is_token_program(const u8 *key) { return same(key, TOKEN_PROGRAM, 32) || same(key, TOKEN_2022_PROGRAM, 32); }
// The address that is the authority of a bounty's token account: derived the way Solana derives it,
// from "cb", the bounty's address and a bump. Only this program can sign for it.
static void token_authority(const u8 *bounty_key, u8 bump, u8 *out) {
  struct sol_bytes parts[5] = { { (const u8 *)"cb", 2 }, { bounty_key, 32 }, { &bump, 1 }, { S->program_id, 32 }, { (const u8 *)"ProgramDerivedAddress", 21 } };
  sol_sha256(parts, 5, out);
}
// Is this account where `wallet` receives the bounty's coin? For SOL it is the wallet itself; for a
// token it is a token account of that coin owned by the wallet.
static bool receives(const struct sol_account_info *to, const u8 *wallet, const u8 *mint) {
  if (!to->is_writable) return 0;
  if (all_zero(mint, 32)) return same(to->key, wallet, 32);
  return is_token_program(to->owner) && to->data_len >= 72 && same(to->data, mint, 32) && same(to->data + 32, wallet, 32);
}
// Pays the whole prize out of the bounty to accounts[to]. For a token, the four accounts from `base`:
// the bounty's token account, the coin, the token authority, the token program.
// Token instruction 12 is TransferChecked: [source, mint, destination, authority], then amount and decimals.
static u64 pay(u64 to_index, u64 base) {
  struct sol_account_info *bounty = &S->accounts[0], *to = &S->accounts[to_index];
  u8 *d = bounty->data;
  u64 amount = le64(d + B_PRIZE);
  if (all_zero(d + B_MINT, 32)) {
    if (amount > *bounty->lamports - le64(d + B_RESERVE)) return 330;
    *bounty->lamports -= amount; *to->lamports += amount;
  } else {
    struct sol_account_info *from = &S->accounts[base], *mint = &S->accounts[base + 1], *authority = &S->accounts[base + 2], *program = &S->accounts[base + 3];
    u8 data[10], bump = d[B_BUMP];
    struct sol_meta metas[4] = { { from->key, 1, 0 }, { mint->key, 0, 0 }, { to->key, 1, 0 }, { authority->key, 0, 1 } };
    struct sol_instruction ix = { program->key, metas, 4, data, 10 };
    struct sol_seed seeds[3] = { { (const u8 *)"cb", 2 }, { bounty->key, 32 }, { &bump, 1 } };
    struct sol_seeds signer = { seeds, 3 };
    struct sol_account_info infos[5];
    if (S->account_count < base + 4) return 331;
    if (!is_token_program(program->key) || !same(mint->key, d + B_MINT, 32) || !same(mint->owner, program->key, 32) || mint->data_len < 45) return 331;
    data[0] = 12; put64(data + 1, amount); data[9] = mint->data[44];
    infos[0] = *from; infos[1] = *mint; infos[2] = *to; infos[3] = *authority; infos[4] = *program;
    if (sol_invoke_signed_c(&ix, infos, 5, &signer, 1) != 0) return 332;
  }
  put64(d + B_PAID_TIME, (u64)now());
  return 0;
}
// Is accounts[index] an entry of this bounty?
static bool is_entry(u64 index) {
  struct sol_account_info *e = &S->accounts[index];
  return S->account_count > index && e->data_len == ENTRY_SIZE && same(e->owner, S->program_id, 32) && same(e->data + E_MAGIC, (const u8 *)"PHILBENT", 8) && same(e->data + E_BOUNTY, S->accounts[0].key, 32);
}

// ---- what each accepted upload does ----
// POST. What is uploaded: "CBTY1", the token authority's bump, the deadline (i64), the grace time in
// seconds (u64), the prize (u64), then the challenge's text.
// Accounts: the bounty, the sponsor (signs), and for a token prize the bounty's token account and the coin.
static u8 post(struct payload *p) {
  struct sol_account_info *bounty = &S->accounts[0], *sponsor = &S->accounts[1];
  const u8 *r = p->bytes;
  u8 *d = bounty->data;
  u64 prize, grace, text_len;
  i64 deadline, t = now();
  if (p->length < 30u + 1u || p->length > 30u + MAX_TEXT || !same(r, (const u8 *)"CBTY1", 5)) return STORE_BAD_RECORD;
  if (S->account_count < 2 || !sponsor->is_signer) return STORE_NOT_SIGNED;
  deadline = (i64)le64(r + 6); grace = le64(r + 14); prize = le64(r + 22); text_len = p->length - 30u;
  if (prize == 0 || deadline <= t || deadline > t + (i64)MAX_AHEAD || grace > MAX_GRACE) return STORE_BAD_TERMS;
  memset(d, 0, BOUNTY_SIZE);
  if (S->account_count >= 4) {
    // A token prize: it must already sit in a token account of that coin that only this program can sign for.
    struct sol_account_info *held = &S->accounts[2], *mint = &S->accounts[3];
    u8 authority[32];
    token_authority(bounty->key, r[5], authority);
    if (!is_token_program(held->owner) || held->data_len < 72 || !same(held->data, mint->key, 32) || !same(held->data + 32, authority, 32) || le64(held->data + 64) < prize) return STORE_NOT_FUNDED;
    memcpy(d + B_MINT, mint->key, 32);
    put64(d + B_RESERVE, *bounty->lamports);
  } else {
    // A SOL prize: it must already be in the bounty's account, on top of the account's rent.
    if (*bounty->lamports <= prize) return STORE_NOT_FUNDED;
    put64(d + B_RESERVE, *bounty->lamports - prize);
  }
  memcpy(d + B_MAGIC, "PHILBNTY", 8);
  d[B_STATE] = OPEN; d[B_BUMP] = r[5];
  memcpy(d + B_SPONSOR, sponsor->key, 32);
  put64(d + B_PRIZE, prize); put64(d + B_DEADLINE, (u64)deadline); put64(d + B_GRACE, grace); put64(d + B_POSTED, (u64)t);
  d[B_TEXT_LEN] = (u8)text_len; d[B_TEXT_LEN + 1] = (u8)(text_len >> 8);
  memcpy(d + B_TEXT, r + 30, text_len);
  LOG("Phil bounty: POSTED. The prize is locked and can only leave for an entrant");
  return 0;
}
// ENTER. What is uploaded: "CENT1", then the link. Accounts: the bounty, a fresh entry account, the entrant (signs).
static u8 enter(struct payload *p) {
  struct sol_account_info *bounty = &S->accounts[0], *entry = &S->accounts[1], *entrant = &S->accounts[2];
  const u8 *r = p->bytes;
  u8 *d = bounty->data, *e;
  u64 link_len;
  u32 count = le32(d + B_COUNT);
  if (p->length < 5u + 1u || p->length > 5u + MAX_LINK || !same(r, (const u8 *)"CENT1", 5)) return STORE_BAD_RECORD;
  if (S->account_count < 3 || !entrant->is_signer) return STORE_NOT_SIGNED;
  if (now() > (i64)le64(d + B_DEADLINE) || le64(d + B_DRAW_SLOT) != 0) return STORE_CLOSED;
  if (count >= MAX_ENTRIES) return STORE_FULL;
  if (!entry->is_writable || entry->data_len != ENTRY_SIZE || !same(entry->owner, S->program_id, 32) || !all_zero(entry->data, ENTRY_SIZE) || same(entry->key, bounty->key, 32)) return STORE_BAD_ENTRY_ACCOUNT;
  link_len = p->length - 5u;
  e = entry->data;
  memcpy(e + E_MAGIC, "PHILBENT", 8);
  memcpy(e + E_BOUNTY, bounty->key, 32);
  memcpy(e + E_ENTRANT, entrant->key, 32);
  put32(e + E_INDEX, count);
  put64(e + E_TIME, (u64)now());
  e[E_LINK_LEN] = (u8)link_len; e[E_LINK_LEN + 1] = 0;
  memcpy(e + E_LINK, r + 5, link_len);
  put32(d + B_COUNT, count + 1);
  LOG("Phil bounty: ENTERED. Entry number:");
  sol_log_64_(0, 0, 0, 0, count);
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
  why = S->op == OP_POST ? post(p) : enter(p);
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

// ================= moving the prize: not Phil =================
static u64 move_prize(void) {
  struct sol_account_info *bounty = &S->accounts[0];
  u8 *d;
  u8 state;
  struct sol_clock clock;
  if (S->account_count < 1 || !bounty->is_writable || bounty->data_len != BOUNTY_SIZE || !same(bounty->owner, S->program_id, 32) || !same(bounty->data, (const u8 *)"PHILBNTY", 8)) return 301;
  d = bounty->data; state = d[B_STATE];
  sol_get_clock_sysvar(&clock);

  if (S->op == OP_AWARD) {
    // Accounts: the bounty, the sponsor (signs), the chosen entry, where its entrant receives, then pay()'s four for a token.
    struct sol_account_info *sponsor = &S->accounts[1], *entry = &S->accounts[2];
    u64 why;
    if (state != OPEN) { LOG("Phil bounty: this prize has already been decided"); return 302; }
    if (S->account_count < 4 || !sponsor->is_signer || !same(sponsor->key, d + B_SPONSOR, 32)) return 303;
    if (le64(d + B_DRAW_SLOT) != 0) { LOG("Phil bounty: too late to pick, the draw has started"); return 304; }
    if (!is_entry(2)) return 305;
    if (!receives(&S->accounts[3], entry->data + E_ENTRANT, d + B_MINT)) return 306;
    why = pay(3, 4);
    if (why) return why;
    d[B_STATE] = PAID; d[B_HOW] = 1;
    memcpy(d + B_WINNER_INDEX, entry->data + E_INDEX, 4); memcpy(d + B_WINNER, entry->data + E_ENTRANT, 32);
    LOG("Phil bounty: AWARDED by the sponsor and PAID. Entry number:");
    sol_log_64_(0, 0, 0, 0, le32(entry->data + E_INDEX));
    return 0;
  }
  if (S->op == OP_ARM) {
    // Accounts: the bounty. Anyone, once the sponsor's time to pick has run out.
    u64 armed = le64(d + B_DRAW_SLOT);
    if (state != OPEN) return 302;
    if (le32(d + B_COUNT) == 0) { LOG("Phil bounty: nobody entered, there is nothing to draw"); return 310; }
    if (clock.unix_time <= (i64)(le64(d + B_DEADLINE) + le64(d + B_GRACE))) { LOG("Phil bounty: too early, the sponsor can still pick"); return 311; }
    if (armed != 0 && clock.slot <= armed + DRAW_WINDOW) { LOG("Phil bounty: a draw is already waiting for its block"); return 312; }
    put64(d + B_DRAW_SLOT, clock.slot + DRAW_AHEAD);
    LOG("Phil bounty: ARMED. The block that will draw:");
    sol_log_64_(0, 0, 0, 0, clock.slot + DRAW_AHEAD);
    return 0;
  }
  if (S->op == OP_DRAW) {
    // Accounts: the bounty, Solana's recent block hashes.
    struct sol_account_info *hashes = &S->accounts[1];
    u64 target = le64(d + B_DRAW_SLOT), count, found = ~0UL;
    if (state != OPEN || target == 0) return 302;
    if (S->account_count < 2 || !same(hashes->key, SLOT_HASHES_ID, 32) || hashes->data_len < 8) return 320;
    if (clock.slot <= target) { LOG("Phil bounty: too early, the draw's block has not passed"); return 321; }
    // Solana keeps the hashes of its most recent blocks, newest first. Take the first block at or after the target.
    count = le64(hashes->data);
    if (count > (hashes->data_len - 8) / 40) count = (hashes->data_len - 8) / 40;
    for (u64 i = 0; i < count && le64(hashes->data + 8 + 40 * i) >= target; i++) found = i;
    if (found == ~0UL || (found == count - 1 && le64(hashes->data + 8 + 40 * found) > target && count >= 512)) { LOG("Phil bounty: that block's hash is no longer kept. ARM again"); return 322; }
    {
      const u8 *entry = hashes->data + 8 + 40 * found;
      u8 mixed[32];
      struct sol_bytes mix[2] = { { entry + 8, 32 }, { bounty->key, 32 } };
      sol_sha256(mix, 2, mixed);
      put32(d + B_WINNER_INDEX, (u32)(le64(mixed) % le32(d + B_COUNT)));
      memcpy(d + B_HASH_SLOT, entry, 8); memcpy(d + B_SLOT_HASH, entry + 8, 32);
      d[B_STATE] = DRAWN; d[B_HOW] = 2;
      LOG("Phil bounty: DRAWN. Block slot, then the winning entry's number:");
      sol_log_64_(0, 0, 0, le64(entry), le32(d + B_WINNER_INDEX));
    }
    return 0;
  }
  if (S->op == OP_CLAIM) {
    // Accounts: the bounty, the entry with the drawn number, where its entrant receives, then pay()'s four for a token.
    struct sol_account_info *entry = &S->accounts[1];
    u64 why;
    if (state != DRAWN) return 302;
    if (S->account_count < 3 || !is_entry(1) || le32(entry->data + E_INDEX) != le32(d + B_WINNER_INDEX)) { LOG("Phil bounty: that is not the entry that was drawn"); return 305; }
    if (!receives(&S->accounts[2], entry->data + E_ENTRANT, d + B_MINT)) return 306;
    why = pay(2, 3);
    if (why) return why;
    d[B_STATE] = PAID;
    memcpy(d + B_WINNER, entry->data + E_ENTRANT, 32);
    LOG("Phil bounty: PAID to the entry a block hash drew");
    return 0;
  }
  // REFUND. Accounts: the bounty, where the sponsor receives, then pay()'s four for a token.
  {
    u64 why;
    if (state != OPEN) return 302;
    if (le32(d + B_COUNT) != 0) { LOG("Phil bounty: there are entries, so the prize cannot go back"); return 340; }
    if (clock.unix_time <= (i64)le64(d + B_DEADLINE)) { LOG("Phil bounty: too early, the deadline has not passed"); return 341; }
    if (S->account_count < 2 || !receives(&S->accounts[1], d + B_SPONSOR, d + B_MINT)) return 306;
    why = pay(1, 2);
    if (why) return why;
    d[B_STATE] = REFUNDED;
    LOG("Phil bounty: REFUNDED. Nobody entered before the deadline");
    return 0;
  }
}

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
  if (S->op < OP_POST || S->op > OP_REFUND) return 103;
  if (S->op >= OP_AWARD) return move_prize();

  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  if (UploadServer(NULL, S->supported, &S->transport) != 0) violate(30);                 /* it returns 0 on every path */
  if (S->hello_frame.stage == 1 || S->begin_frame.stage == 1) violate(31);                /* a frame left pending */
  if (S->payload.held) violate(32);                                                       /* a payload neither stored nor released */
  if (S->violation) { LOG("Phil runtime: the server broke one of the protocol's ownership rules; refusing"); return 2000u + S->violation; }
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil bounty: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED fails the transaction, so nothing changes. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}
