// A Solana runtime for Phil's upload server, used as the referee of a two-player game.
//
// The game is The Line (rules "duels-1", from github.com/HigherMaestro/highwire, MIT): a node sits
// in the middle of a wire with seven places. Each round both players secretly choose a pull from 0
// up to their energy; the bigger pull moves the node one place toward its player; both pay what
// they pulled. Reaching your end wins. After 15 rounds the side the node is on wins.
//
// Nothing is staked here: a match holds no SOL beyond its own account's rent, and there is no
// instruction that pays anyone. It is the referee only.
//
// Moves are hidden by commit and reveal. A player first sends SHA-256(match, round, side, pull,
// nonce). When both have committed, each reveals by uploading those 67 bytes through
// `UploadServer`, the function Phil's LLVM backend emits (see giveaway/runtime.c for how that
// interface is met on Solana). The reveal must declare the committed hash as its digest, so the
// check that the revealed bytes are the committed ones is made by Phil's server, not by us.
//
//   OPEN     makes a match and seats player A.
//   JOIN     seats player B and opens round 1.
//   COMMIT   records one side's hash for the round in play.
//   REVEAL   opens it. When both are open the round is played by the rules below.
//   TIMEOUT  anyone may send it after a phase's time limit: the side that did not move forfeits.
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
static u32 le32(const u8 *p) { return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24); }
static void put64(u8 *p, u64 v) { for (int i = 0; i < 8; i++) { p[i] = (u8)v; v >>= 8; } }

// ---- instructions, outcomes, limits ----
enum { OP_OPEN = 1, OP_JOIN = 2, OP_COMMIT = 3, OP_REVEAL = 4, OP_TIMEOUT = 5 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2, POLICY_BAD_MATCH = 3, POLICY_WRONG_PHASE = 4, POLICY_NOT_A_PLAYER = 5,
       POLICY_ALREADY_MOVED = 6, POLICY_NOT_THE_COMMITMENT = 7, POLICY_NOT_SIGNED = 8 };
enum { STORE_BAD_RECORD = 1, STORE_BAD_TERMS = 2, STORE_NOT_INVITED = 3, STORE_SAME_PLAYER = 4, STORE_WRONG_ROUND = 5,
       STORE_TOO_LATE = 6, STORE_NAMES_ANOTHER_MOVE = 7, STORE_PULL_TOO_BIG = 8 };
#define MAX_PAYLOAD 80u
static const char KIND_OPEN[] = "phil-line/open";
static const char KIND_JOIN[] = "phil-line/join";
static const char KIND_COMMIT[] = "phil-line/commit";
static const char KIND_REVEAL[] = "phil-line/reveal";

// ---- the rules ("duels-1") ----
#define PLACES 7u          /* the node is at 0..6; 3 is the middle. A pulls toward 0, B toward 6 */
#define MIDDLE 3u
#define START_ENERGY 30u
#define REGAIN 2u
#define ROUNDS 15u
#define MIN_WINDOW 20u     /* seconds a side has for each commit and each reveal */
#define MAX_WINDOW 86400u

// ---- the match account: 320 bytes ----
enum { EMPTY = 0, WAITING = 1, COMMITTING = 2, REVEALING = 3, OVER = 4 };
enum { RESULT_NONE = 0, A_WON = 1, B_WON = 2, DRAWN = 3, VOID = 4 };
enum { HOW_NONE = 0, HOW_REACHED_END = 1, HOW_FIFTEEN_ROUNDS = 2, HOW_NO_REVEAL = 3, HOW_NO_COMMIT = 4, HOW_NOBODY_MOVED = 5 };
enum { A_COMMITTED = 1, B_COMMITTED = 2, A_REVEALED = 4, B_REVEALED = 8 };
#define MATCH_SIZE 320u
#define K_MAGIC 0          /* "PHILLINE" */
#define K_STATE 8
#define K_ROUND 9          /* 1..15 */
#define K_NODE 10          /* 0..6 */
#define K_RESULT 11
#define K_HOW 12
#define K_ENERGY 13        /* A's, then B's */
#define K_FLAGS 15
#define K_PHASE_START 16   /* i64 Unix seconds: when the phase in play opened */
#define K_OPENED_TIME 24
#define K_ENDED_TIME 32
#define K_WINDOW 40        /* u32 seconds */
#define K_INVITED 44       /* 1: only the invited wallet may join */
#define K_PULL 48          /* this round's revealed pulls: A's, then B's */
#define K_PLAYER 64        /* A's key, then B's (32 bytes each): the keys that sign moves */
#define K_OWNER 128        /* A's wallet, then B's: who the player key plays for */
#define K_COMMIT 192       /* this round's commitments: A's, then B's */
#define K_HISTORY 256      /* every played round's pulls: A's, B's, 15 times */

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
  u8 side;                                    /* 0 for A, 1 for B: whose move this is */
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
  struct sol_account_info *match = &S->accounts[0], *player = &S->accounts[1];
  const char *kind = S->op == OP_OPEN ? KIND_OPEN : S->op == OP_JOIN ? KIND_JOIN : S->op == OP_COMMIT ? KIND_COMMIT : KIND_REVEAL;
  u64 kind_len = S->op == OP_OPEN ? sizeof(KIND_OPEN) - 1 : S->op == OP_JOIN ? sizeof(KIND_JOIN) - 1 : S->op == OP_COMMIT ? sizeof(KIND_COMMIT) - 1 : sizeof(KIND_REVEAL) - 1;
  u8 wanted = S->op == OP_OPEN ? EMPTY : S->op == OP_JOIN ? WAITING : S->op == OP_COMMIT ? COMMITTING : REVEALING;
  u8 why = 0;
  (void)policy_context;
  MUST(begin_record == &S->begin && S->begin_frame.stage == 2, 14);
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != kind_len || !same(b->kind, (const u8 *)kind, kind_len)) why = POLICY_WRONG_KIND;
  else if (S->account_count < 2 || match->data_len < MATCH_SIZE || !match->is_writable || !same(match->owner, S->program_id, 32)) why = POLICY_BAD_MATCH;
  else if (match->data[K_STATE] != wanted) why = POLICY_WRONG_PHASE;
  else if (!player->is_signer) why = POLICY_NOT_SIGNED;
  else if (S->op == OP_COMMIT || S->op == OP_REVEAL) {
    const u8 *d = match->data;
    if (same(player->key, d + K_PLAYER, 32)) S->side = 0;
    else if (same(player->key, d + K_PLAYER + 32, 32)) S->side = 1;
    else why = POLICY_NOT_A_PLAYER;
    if (!why && (d[K_FLAGS] & (S->op == OP_COMMIT ? (A_COMMITTED << S->side) : (A_REVEALED << S->side)))) why = POLICY_ALREADY_MOVED;
    // A reveal must declare the hash this side committed. Phil's server then checks the bytes against it.
    if (!why && S->op == OP_REVEAL && !same(b->digest, d + K_COMMIT + 32u * S->side, 32)) why = POLICY_NOT_THE_COMMITMENT;
  }
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
static void finish(u8 *d, u8 result, u8 how, i64 at) {
  d[K_STATE] = OVER; d[K_RESULT] = result; d[K_HOW] = how; put64(d + K_ENDED_TIME, (u64)at);
  LOG("Phil line: the match is over. Result (1 A won, 2 B won, 3 drawn, 4 void), then how it ended:");
  sol_log_64_(0, 0, 0, result, how);
}

// OPEN. What is uploaded: "LINE1", seconds per phase u32, 1 if only one wallet may join, that wallet (32 bytes, zero if anyone).
// Accounts: match, player A's key (signs), the wallet it plays for (signs; may be the same account).
static u8 open_match(struct payload *p) {
  struct sol_account_info *match = &S->accounts[0], *player = &S->accounts[1], *owner = &S->accounts[S->account_count > 2 ? 2 : 1];
  const u8 *r = p->bytes;
  u8 *d = match->data;
  u32 window;
  i64 at = now();
  if (p->length != 42 || !same(r, (const u8 *)"LINE1", 5) || r[9] > 1) return STORE_BAD_RECORD;
  window = le32(r + 5);
  if (window < MIN_WINDOW || window > MAX_WINDOW || !owner->is_signer) return STORE_BAD_TERMS;
  memset(d, 0, MATCH_SIZE);
  memcpy(d + K_MAGIC, "PHILLINE", 8);
  d[K_STATE] = WAITING; d[K_NODE] = MIDDLE; d[K_ENERGY] = START_ENERGY; d[K_ENERGY + 1] = START_ENERGY; d[K_INVITED] = r[9];
  d[K_WINDOW] = r[5]; d[K_WINDOW + 1] = r[6]; d[K_WINDOW + 2] = r[7]; d[K_WINDOW + 3] = r[8];
  put64(d + K_OPENED_TIME, (u64)at); put64(d + K_PHASE_START, (u64)at);
  memcpy(d + K_PLAYER, player->key, 32); memcpy(d + K_OWNER, owner->key, 32);
  if (r[9]) memcpy(d + K_OWNER + 32, r + 10, 32);
  LOG("Phil line: OPEN. Player A is seated and waits for an opponent");
  return 0;
}

// JOIN. What is uploaded: "JOIN1". Accounts: match, player B's key (signs), the wallet it plays for (signs).
static u8 join_match(struct payload *p) {
  struct sol_account_info *match = &S->accounts[0], *player = &S->accounts[1], *owner = &S->accounts[S->account_count > 2 ? 2 : 1];
  u8 *d = match->data;
  if (p->length != 5 || !same(p->bytes, (const u8 *)"JOIN1", 5)) return STORE_BAD_RECORD;
  if (!owner->is_signer) return STORE_BAD_TERMS;
  if (same(player->key, d + K_PLAYER, 32)) return STORE_SAME_PLAYER;
  if (d[K_INVITED] && !same(owner->key, d + K_OWNER + 32, 32)) return STORE_NOT_INVITED;
  memcpy(d + K_PLAYER + 32, player->key, 32); memcpy(d + K_OWNER + 32, owner->key, 32);
  d[K_STATE] = COMMITTING; d[K_ROUND] = 1; put64(d + K_PHASE_START, (u64)now());
  LOG("Phil line: JOINED. Player B is seated and round 1 is open");
  return 0;
}

// COMMIT. What is uploaded: "LCOM1", the round, the 32-byte hash. Accounts: match, the player's key (signs).
static u8 commit_move(struct payload *p) {
  u8 *d = S->accounts[0].data;
  const u8 *r = p->bytes;
  i64 at = now();
  if (p->length != 38 || !same(r, (const u8 *)"LCOM1", 5)) return STORE_BAD_RECORD;
  if (r[5] != d[K_ROUND]) return STORE_WRONG_ROUND;
  if (at > (i64)le64(d + K_PHASE_START) + (i64)le32(d + K_WINDOW)) return STORE_TOO_LATE;
  memcpy(d + K_COMMIT + 32u * S->side, r + 6, 32);
  d[K_FLAGS] |= (u8)(A_COMMITTED << S->side);
  LOG("Phil line: COMMITTED. A hidden move is recorded for this round");
  if ((d[K_FLAGS] & (A_COMMITTED | B_COMMITTED)) == (A_COMMITTED | B_COMMITTED)) {
    d[K_STATE] = REVEALING; put64(d + K_PHASE_START, (u64)at);
    LOG("Phil line: both sides have committed. Reveals are open");
  }
  return 0;
}

// Both pulls are known: play the round by the rules.
static void play_round(u8 *d, i64 at) {
  u8 a = d[K_PULL], b = d[K_PULL + 1], round = d[K_ROUND];
  d[K_ENERGY] = (u8)(d[K_ENERGY] - a); d[K_ENERGY + 1] = (u8)(d[K_ENERGY + 1] - b);          /* both pay what they pulled */
  if (a > b) d[K_NODE] = (u8)(d[K_NODE] - 1); else if (b > a) d[K_NODE] = (u8)(d[K_NODE] + 1);
  d[K_HISTORY + 2u * (round - 1u)] = a; d[K_HISTORY + 2u * (round - 1u) + 1] = b;
  LOG("Phil line: ROUND PLAYED. Round, A's pull, B's pull, where the node is now (0 is A's end, 6 is B's):");
  sol_log_64_(0, round, a, b, d[K_NODE]);
  if (d[K_NODE] == 0) { finish(d, A_WON, HOW_REACHED_END, at); return; }
  if (d[K_NODE] == PLACES - 1) { finish(d, B_WON, HOW_REACHED_END, at); return; }
  if (round == ROUNDS) { finish(d, d[K_NODE] < MIDDLE ? A_WON : d[K_NODE] > MIDDLE ? B_WON : DRAWN, HOW_FIFTEEN_ROUNDS, at); return; }
  for (int i = 0; i < 2; i++) d[K_ENERGY + i] = (u8)(d[K_ENERGY + i] + REGAIN > START_ENERGY ? START_ENERGY : d[K_ENERGY + i] + REGAIN);
  d[K_ROUND] = (u8)(round + 1); d[K_FLAGS] = 0; d[K_STATE] = COMMITTING; put64(d + K_PHASE_START, (u64)at);
  memset(d + K_COMMIT, 0, 64); d[K_PULL] = 0; d[K_PULL + 1] = 0;
}

// REVEAL. What is uploaded is exactly what was hashed: the match's address (32 bytes), the round, the side
// (0 for A, 1 for B), the pull, a 32-byte nonce. Phil's server has already checked these bytes against the
// committed hash. Accounts: match, the player's key (signs).
static u8 reveal_move(struct payload *p) {
  u8 *d = S->accounts[0].data;
  const u8 *r = p->bytes;
  i64 at = now();
  if (p->length != 67) return STORE_BAD_RECORD;
  if (!same(r, S->accounts[0].key, 32) || r[32] != d[K_ROUND] || r[33] != S->side) return STORE_NAMES_ANOTHER_MOVE;
  if (r[34] > d[K_ENERGY + S->side]) return STORE_PULL_TOO_BIG;
  if (at > (i64)le64(d + K_PHASE_START) + (i64)le32(d + K_WINDOW)) return STORE_TOO_LATE;
  d[K_PULL + S->side] = r[34];
  d[K_FLAGS] |= (u8)(A_REVEALED << S->side);
  LOG("Phil line: REVEALED. The move is the one that was committed");
  if ((d[K_FLAGS] & (A_REVEALED | B_REVEALED)) == (A_REVEALED | B_REVEALED)) play_round(d, at);
  return 0;
}

// TIMEOUT. Not an upload: anyone may send it, with the match as its only account, once the phase in
// play has run past its time limit. The side that did not move forfeits; if neither moved, the match is void.
static u64 timeout(void) {
  struct sol_account_info *match = &S->accounts[0];
  u8 *d = match->data;
  i64 at = now();
  u8 moved;
  if (S->account_count < 1 || match->data_len < MATCH_SIZE || !match->is_writable || !same(match->owner, S->program_id, 32) || !same(d, (const u8 *)"PHILLINE", 8)) return 131;
  if (d[K_STATE] != COMMITTING && d[K_STATE] != REVEALING) return 132;
  if (at <= (i64)le64(d + K_PHASE_START) + (i64)le32(d + K_WINDOW)) { LOG("Phil line: not yet. The phase in play still has time left"); return 133; }
  moved = d[K_STATE] == COMMITTING ? (u8)(d[K_FLAGS] & (A_COMMITTED | B_COMMITTED)) : (u8)((d[K_FLAGS] >> 2) & (A_COMMITTED | B_COMMITTED));
  LOG("Phil line: TIME. A side did not move within the limit");
  if (moved == A_COMMITTED) finish(d, A_WON, d[K_STATE] == COMMITTING ? HOW_NO_COMMIT : HOW_NO_REVEAL, at);
  else if (moved == B_COMMITTED) finish(d, B_WON, d[K_STATE] == COMMITTING ? HOW_NO_COMMIT : HOW_NO_REVEAL, at);
  else finish(d, VOID, HOW_NOBODY_MOVED, at);
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
  why = S->op == OP_OPEN ? open_match(p) : S->op == OP_JOIN ? join_match(p) : S->op == OP_COMMIT ? commit_move(p) : reveal_move(p);
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
  if (S->op == OP_TIMEOUT) return ix_len == 1 ? timeout() : 103;
  if (S->op < OP_OPEN || S->op > OP_REVEAL) return 103;

  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  if (UploadServer(NULL, S->supported, &S->transport) != 0) violate(30);                 /* it returns 0 on every path */
  if (S->hello_frame.stage == 1 || S->begin_frame.stage == 1) violate(31);                /* a frame left pending */
  if (S->payload.held) violate(32);                                                       /* a payload neither stored nor released */
  if (S->violation) { LOG("Phil runtime: the server broke one of the protocol's ownership rules; refusing"); return 2000u + S->violation; }
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil line: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED fails the transaction, so the match does not change. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}
