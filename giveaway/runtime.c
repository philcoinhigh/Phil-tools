// A Solana runtime for the upload server that Phil's LLVM backend emits.
//
// Phil's backend (the `phil-llvm-phase0-control-codec` emitter in abiggerhammer/phil) produces a
// function `UploadServer`. That function is the protocol: receive Hello, agree a version, receive
// Begin, apply the policy, receive exactly Begin.length bytes, check their SHA-256 against the
// digest Begin declared, store, and answer accepted or rejected. It does none of the byte work
// itself. It calls a runtime for every step, through the interface in Phil's
// runtime/phase0/integrated_upload_v1.h. Phil's repository has a runtime for a desktop machine.
// This file is that runtime for Solana:
//
//   the transport is the instruction data, in the frame format of Phil's control codec v1;
//   SHA-256 is Solana's own (the sol_sha256 syscall);
//   "store" writes the locked giveaway into an account this program owns.
//
// What is uploaded is a giveaway: its title, how many winners, and the list of entries (or the
// list's fingerprint, when the list is too long for one transaction). Phil's server decides
// whether it is accepted. A second instruction, DRAW, is not Phil: once the chosen slot has
// passed it reads that slot's block hash from Solana and derives the winner.
//
// Nothing here is allocated. Records are views into the instruction data, and the working state
// lives in the program's heap region, which Solana hands over zeroed.
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long u64;
typedef long i64;
#define bool _Bool
#define NULL ((void *)0)

// Provided by Solana's virtual machine (and by giveaway/native/harness.c in the native tests).
extern void sol_log_(const char *message, u64 length);
extern void sol_log_64_(u64 a, u64 b, u64 c, u64 d, u64 e);
struct sol_bytes { const u8 *addr; u64 len; };
extern u64 sol_sha256(const struct sol_bytes *parts, u64 count, u8 *out);
struct sol_clock { u64 slot; i64 epoch_start; u64 epoch; u64 leader_epoch; i64 unix_time; };
extern u64 sol_get_clock_sysvar(struct sol_clock *out);

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
static u64 le64(const u8 *p) { u64 v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | p[i]; return v; }
static void put32(u8 *p, u32 v) { for (int i = 0; i < 4; i++) { p[i] = (u8)v; v >>= 8; } }
static void put64(u8 *p, u64 v) { for (int i = 0; i < 8; i++) { p[i] = (u8)v; v >>= 8; } }

// ---- instructions, outcomes, limits ----
enum { OP_LOCK = 1, OP_DRAW = 2, OP_CHECK = 3 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2, POLICY_ALREADY_LOCKED = 3, POLICY_BAD_ACCOUNT = 4 };
enum { STORE_BAD_RECORD = 1, STORE_BAD_COUNT = 2, STORE_NOT_THE_LOCKED_LIST = 3 };
#define MAX_PAYLOAD 940u
#define MIN_DELAY 20u          /* slots: about eight seconds */
#define MAX_DELAY 432000u      /* slots: about two days */
static const char KIND[] = "phil-draw/1";
#define KIND_LEN (sizeof(KIND) - 1)

// ---- the draw account: 256 bytes, written once by LOCK and once by DRAW ----
enum { EMPTY = 0, LOCKED = 1, DRAWN = 2, EXPIRED = 3 };
#define DRAW_SIZE 256u
#define D_MAGIC 0      /* "PHILDRAW" */
#define D_STATE 8
#define D_KIND 9       /* 1: the list itself was uploaded. 2: its SHA-256 was. */
#define D_WINNERS 10
#define D_TITLE_LEN 11
#define D_COUNT 12     /* u32 entries */
#define D_DELAY 16     /* u32 slots */
#define D_PAYLOAD_LEN 20
#define D_LOCK_SLOT 24
#define D_LOCK_TIME 32
#define D_TARGET_SLOT 40
#define D_PAYLOAD_DIGEST 48   /* what Phil's server validated */
#define D_LIST_DIGEST 80      /* SHA-256 of the entry list */
#define D_HASH_SLOT 112
#define D_SLOT_HASH 120
#define D_RANDOMNESS 152
#define D_WINNER 184          /* u64: index of the first winner in the list */
#define D_TITLE 192           /* up to 64 bytes */

// ---- working state, in the heap region ----
struct account { const u8 *key; const u8 *owner; u8 *data; u64 data_len; u8 writable; };
struct transport { const u8 *bytes; u64 available; u64 cursor; };
struct frame { const u8 *bytes; u64 length; u8 tag; u8 problem; };
struct hello { const u8 *versions; u16 count; };
struct begin { u64 length; const u8 *kind; const u8 *digest; u8 kind_len; };
struct payload { const u8 *bytes; u64 length; u8 held; };
struct state {
  struct account accounts[4];
  u64 account_count;
  const u8 *program_id;
  struct transport transport;
  struct frame hello_frame, begin_frame;
  struct hello hello;
  struct begin begin;
  struct payload payload;
  u8 computed[32];
  u16 supported[2];
  u8 op, outcome, reason, recognition_reason;
};
#define HEAP ((struct state *)0x300000000UL)
#define S HEAP

// ================= the interface Phil's upload server calls =================

static void receive_frame(struct transport *t, u8 tag, struct frame *f, void **pending_out, void **frame_out) {
  const u8 *b = t->bytes + t->cursor;
  u64 left = t->available - t->cursor;
  f->bytes = b; f->tag = tag; f->length = 0; f->problem = 0;
  if (left < 8) f->problem = 2;                                                  /* short header */
  else if (b[0] != 0x50 || b[1] != 0x48 || b[2] != 0x49 || b[3] != 0x4c) f->problem = 3;   /* "PHIL" */
  else if (b[4] != 1) f->problem = 4;                                            /* codec version */
  else if (b[5] != tag) f->problem = 5;
  else if (left < 8u + be16(b + 6)) f->problem = 6;                              /* truncated */
  else f->length = 8u + be16(b + 6);
  *pending_out = f; *frame_out = f;
}
void phil_runtime_receive_frame_Hello(void *transport, void **pending_out, void **frame_out) { receive_frame(transport, 1, &S->hello_frame, pending_out, frame_out); }
void phil_runtime_receive_frame_Begin(void *transport, void **pending_out, void **frame_out) { receive_frame(transport, 2, &S->begin_frame, pending_out, frame_out); }
void *phil_runtime_frame_borrow_view_Hello(void *frame) { return frame; }
void *phil_runtime_frame_borrow_view_Begin(void *frame) { return frame; }

u8 phil_runtime_recognize_Hello(void *pending, void *raw_view, void **record_out, void **reason_out) {
  struct frame *f = raw_view;
  const u8 *p = f->bytes + 8;
  u64 n = f->length - 8;
  u8 why = 0;
  *record_out = NULL; *reason_out = &S->recognition_reason;
  if (pending != raw_view || f->problem) why = (u8)(100 + f->problem);
  else if (n < 2) why = 2;
  else if (be16(p) == 0) why = 1;
  else if (2u + 2u * be16(p) != n) why = 2;
  else for (u16 i = 1; i < be16(p); i++) if (be16(p + 2 * i) >= be16(p + 2 + 2 * i)) why = 3;   /* strictly ascending */
  if (why) { S->recognition_reason = why; return 0; }
  S->hello.count = be16(p); S->hello.versions = p + 2;
  *record_out = &S->hello;
  LOG("Phil: Hello recognized");
  return 1;
}
u8 phil_runtime_recognize_Begin(void *pending, void *raw_view, void **record_out, void **reason_out) {
  struct frame *f = raw_view;
  const u8 *p = f->bytes + 8;
  u64 n = f->length - 8;
  u8 why = 0;
  *record_out = NULL; *reason_out = &S->recognition_reason;
  if (pending != raw_view || f->problem) why = (u8)(100 + f->problem);
  else if (n < 42) why = 1;
  else if (p[8] == 0) why = 2;
  else if (42u + p[8] != n) why = 1;
  else if (p[9 + p[8]] != 1) why = 3;                                            /* SHA-256 only */
  if (why) { S->recognition_reason = why; return 0; }
  S->begin.length = be64(p); S->begin.kind_len = p[8]; S->begin.kind = p + 9; S->begin.digest = p + 10 + p[8];
  *record_out = &S->begin;
  LOG("Phil: Begin recognized");
  return 1;
}
void phil_runtime_commit_ingress_Hello(void *transport, void *pending) { ((struct transport *)transport)->cursor += ((struct frame *)pending)->length; }
void phil_runtime_commit_ingress_Begin(void *transport, void *pending) { ((struct transport *)transport)->cursor += ((struct frame *)pending)->length; }
void phil_runtime_fail_recognition_Hello(void *pending, void *reason) { (void)pending; S->outcome = RECOGNITION_FAILED; S->reason = *(u8 *)reason; LOG("Phil: the Hello frame was not recognized"); }
void phil_runtime_fail_recognition_Begin(void *pending, void *reason) { (void)pending; S->outcome = RECOGNITION_FAILED; S->reason = *(u8 *)reason; LOG("Phil: the Begin frame was not recognized"); }
void phil_runtime_destroy_pending_Hello(void *pending, void *frame) { (void)pending; (void)frame; }
void phil_runtime_destroy_pending_Begin(void *pending, void *frame) { (void)pending; (void)frame; }

void *phil_record_Hello_get_versions(void *hello_record) { return hello_record; }
u64 phil_record_Begin_get_length(void *begin_record) { return ((struct begin *)begin_record)->length; }

bool phil_runtime_validate_hello_policy(void *policy_context, void *hello_record, void **rejection_reason_out) {
  (void)policy_context;
  *rejection_reason_out = &S->reason;
  if (((struct hello *)hello_record)->count > 16) { S->reason = 1; return 0; }
  return 1;
}
void phil_runtime_fail_hello_policy(void *transport, void *rejection_reason) { (void)transport; (void)rejection_reason; S->outcome = HELLO_POLICY_FAILED; LOG("Phil: the Hello was refused by policy"); }

bool phil_runtime_choose_supported(void *server_supported, void *offered_versions, u16 *selected_version_out) {
  const u16 *mine = server_supported;       /* a count, then the versions */
  struct hello *theirs = offered_versions;
  bool found = 0; u16 best = 0;
  for (u16 i = 0; i < theirs->count; i++) for (u16 j = 0; j < mine[0]; j++)
    if (be16(theirs->versions + 2 * i) == mine[1 + j] && (!found || mine[1 + j] > best)) { found = 1; best = mine[1 + j]; }
  if (found) *selected_version_out = best;
  return found;
}
void phil_runtime_select_unsupported(void *transport) { (void)transport; S->outcome = UNSUPPORTED; LOG("Phil: no protocol version in common"); }
void phil_runtime_select_version(void *transport, u16 selected_version) { (void)transport; (void)selected_version; LOG("Phil: version agreed"); }

bool phil_runtime_validate_begin_policy(void *policy_context, void *begin_record, u8 *rejection_reason_out) {
  struct begin *b = begin_record;
  struct account *draw = &S->accounts[0];
  u8 why = 0;
  (void)policy_context;
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != KIND_LEN || !same(b->kind, (const u8 *)KIND, KIND_LEN)) why = POLICY_WRONG_KIND;
  else if (S->account_count < 1 || draw->data_len < DRAW_SIZE || !same(draw->owner, S->program_id, 32)) why = POLICY_BAD_ACCOUNT;
  else if (S->op == OP_LOCK && !draw->writable) why = POLICY_BAD_ACCOUNT;
  else if (S->op == OP_LOCK && draw->data[D_STATE] != EMPTY) why = POLICY_ALREADY_LOCKED;
  if (why) { *rejection_reason_out = why; return 0; }
  return 1;
}
void phil_runtime_select_begin_policy_reject(void *transport, u8 rejection_reason) { (void)transport; S->outcome = POLICY_REJECTED; S->reason = rejection_reason; LOG("Phil: REJECTED by policy before any payload was read"); }
void phil_runtime_select_begin_policy_proceed(void *transport) { (void)transport; LOG("Phil: policy passed, proceed"); }

bool phil_runtime_receive_payload_cancel(void *transport) {
  struct transport *t = transport;
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
  struct transport *t = transport;
  u64 left = t->available - t->cursor;
  u64 taken = length <= left ? length : left;
  S->payload.bytes = t->bytes + t->cursor; S->payload.length = taken; S->payload.held = 1;
  t->cursor += taken;
  *payload_out = &S->payload;
  if (length > left) { S->outcome = EARLY_EOF; LOG("Phil: fewer bytes arrived than Begin declared"); return 0; }
  LOG("Phil: payload received, exactly the declared length");
  return 1;
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
  if (b != &S->begin || p != &S->payload || !p->held) return 0;
  sol_sha256(&part, 1, S->computed);
  if (!same(S->computed, b->digest, 32)) return 0;
  LOG("Phil: SHA-256 matches the declared digest");
  return 1;
}
void phil_buffer_release(void *payload) { ((struct payload *)payload)->held = 0; }

// The record that is uploaded:
//   "DRAW1", kind u8, entries u32, winners u8, delay u32 (slots), title length u8, title,
//   then the entry list (kind 1: lines separated by '\n') or its SHA-256 (kind 2).
u8 phil_runtime_store_with_error(void *payload, void **upload_id_out, void **storage_error_out) {
  struct payload *p = payload;
  struct account *draw = &S->accounts[0];
  const u8 *r = p->bytes;
  u8 list_digest[32];
  u8 why = 0;
  u32 count = 0, delay = 0; u8 kind = 0, winners = 0, title_len = 0; u64 head = 0;
  *storage_error_out = &S->reason;
  if (p->length < 16 || !same(r, (const u8 *)"DRAW1", 5)) why = STORE_BAD_RECORD;
  else {
    kind = r[5]; count = le32(r + 6); winners = r[10]; delay = le32(r + 11); title_len = r[15]; head = 16u + title_len;
    if ((kind != 1 && kind != 2) || title_len == 0 || title_len > 64 || head > p->length) why = STORE_BAD_RECORD;
    else if (count == 0 || winners == 0 || winners > count || delay < MIN_DELAY || delay > MAX_DELAY) why = STORE_BAD_COUNT;
    else if (kind == 2 && p->length != head + 32) why = STORE_BAD_RECORD;
    else if (kind == 2) memcpy(list_digest, r + head, 32);
    else {
      // The list itself: every line non-empty, and as many lines as the record says.
      u32 lines = 1; bool empty = (p->length == head);
      for (u64 i = head; i < p->length; i++) if (r[i] == '\n') { lines++; if (i + 1 == p->length || r[i + 1] == '\n' || i == head) empty = 1; }
      if (empty || lines != count) why = STORE_BAD_COUNT;
      else { struct sol_bytes part = { r + head, p->length - head }; sol_sha256(&part, 1, list_digest); }
    }
  }
  if (!why && S->op == OP_CHECK) {
    if (draw->data[D_STATE] == EMPTY || !same(draw->data + D_PAYLOAD_DIGEST, S->computed, 32)) why = STORE_NOT_THE_LOCKED_LIST;
    else LOG("Phil draw: this is byte for byte the giveaway that is locked");
  }
  if (why) { S->reason = why; return 0; }
  if (S->op == OP_LOCK) {
    struct sol_clock clock;
    u8 *d = draw->data;
    sol_get_clock_sysvar(&clock);
    memset(d, 0, DRAW_SIZE);
    memcpy(d + D_MAGIC, "PHILDRAW", 8);
    d[D_STATE] = LOCKED; d[D_KIND] = kind; d[D_WINNERS] = winners; d[D_TITLE_LEN] = title_len;
    put32(d + D_COUNT, count); put32(d + D_DELAY, delay); put32(d + D_PAYLOAD_LEN, (u32)p->length);
    put64(d + D_LOCK_SLOT, clock.slot); put64(d + D_LOCK_TIME, (u64)clock.unix_time); put64(d + D_TARGET_SLOT, clock.slot + delay);
    memcpy(d + D_PAYLOAD_DIGEST, S->computed, 32); memcpy(d + D_LIST_DIGEST, list_digest, 32);
    memcpy(d + D_TITLE, r + 16, title_len);
    LOG("Phil draw: giveaway locked. Target slot:");
    sol_log_64_(0, 0, 0, clock.slot, clock.slot + delay);
  }
  p->held = 0;
  *upload_id_out = (void *)draw->key;
  return 1;
}
void phil_runtime_fail_storage(void *transport, void *storage_error) { (void)transport; (void)storage_error; S->outcome = STORAGE_FAILED; LOG("Phil: the upload was valid but could not be stored"); }
void phil_runtime_select_accepted(void *transport, void *upload_id) { (void)transport; (void)upload_id; S->outcome = ACCEPTED; LOG("Phil: ACCEPTED"); }
void phil_runtime_select_rejected(void *transport, u8 reason) { (void)transport; S->outcome = REJECTED; S->reason = reason; LOG("Phil: REJECTED, the bytes do not match the declared digest"); }

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

// ================= DRAW: not Phil. Solana's block hash picks the winner. =================
static const u8 SLOT_HASHES_ID[32] = { 0x06, 0xa7, 0xd5, 0x17, 0x19, 0x2f, 0x0a, 0xaf, 0xc6, 0xf2, 0x65, 0xe3, 0xfb, 0x77, 0xcc, 0x7a, 0xda, 0x82, 0xc5, 0x29, 0xd0, 0xbe, 0x3b, 0x13, 0x6e, 0x2d, 0x00, 0x55, 0x20, 0x00, 0x00, 0x00 };

static u64 draw(void) {
  struct account *acct = &S->accounts[0], *hashes = &S->accounts[1];
  struct sol_clock clock;
  u8 *d;
  u64 target, count, found = ~0UL;
  if (S->account_count < 2 || acct->data_len < DRAW_SIZE || !acct->writable || !same(acct->owner, S->program_id, 32)) return 201;
  if (!same(hashes->key, SLOT_HASHES_ID, 32) || hashes->data_len < 8) return 202;
  d = acct->data;
  if (d[D_STATE] != LOCKED) { LOG("Phil draw: nothing to draw: not locked, or already drawn"); return 203; }
  sol_get_clock_sysvar(&clock);
  target = le64(d + D_TARGET_SLOT);
  if (clock.slot <= target) { LOG("Phil draw: too early, the target slot has not passed"); return 204; }
  // Solana keeps the hashes of its most recent blocks, newest first. Take the first block at or
  // after the target slot. If the target is older than everything kept, the draw has expired.
  count = le64(hashes->data);
  if (count > (hashes->data_len - 8) / 40) count = (hashes->data_len - 8) / 40;
  if (count == 0) return 205;
  if (le64(hashes->data + 8 + 40 * (count - 1)) > target && count >= 512) {
    d[D_STATE] = EXPIRED;
    LOG("Phil draw: EXPIRED. Nobody drew within the window; this giveaway can never produce a winner");
    return 0;
  }
  for (u64 i = 0; i < count && le64(hashes->data + 8 + 40 * i) >= target; i++) found = i;   /* newest first: walk back to the target */
  if (found == ~0UL) { LOG("Phil draw: too early, no block at or after the target slot yet"); return 204; }
  {
    const u8 *entry = hashes->data + 8 + 40 * found;
    u8 randomness[32], first[32], zero[4] = { 0, 0, 0, 0 };
    struct sol_bytes mix[3] = { { d + D_PAYLOAD_DIGEST, 32 }, { entry + 8, 32 }, { acct->key, 32 } };
    struct sol_bytes pick[2] = { { randomness, 32 }, { zero, 4 } };
    u64 winner;
    sol_sha256(mix, 3, randomness);
    sol_sha256(pick, 2, first);
    winner = le64(first) % le32(d + D_COUNT);
    memcpy(d + D_HASH_SLOT, entry, 8); memcpy(d + D_SLOT_HASH, entry + 8, 32); memcpy(d + D_RANDOMNESS, randomness, 32);
    put64(d + D_WINNER, winner);
    d[D_STATE] = DRAWN;
    LOG("Phil draw: DRAWN. Block slot, then the winning entry's position (counting from 0):");
    sol_log_64_(0, 0, 0, le64(entry), winner);
  }
  return 0;
}

// ================= Solana's entry point =================
u64 entrypoint(const u8 *input) {
  const u8 *in = input;
  const u8 *ix; u64 ix_len;
  u64 n = le64(in); in += 8;
  if (n > 4) return 101;
  S->account_count = n;
  for (u64 i = 0; i < n; i++) {
    if (in[0] != 0xff) { S->accounts[i] = S->accounts[in[0]]; in += 8; continue; }
    S->accounts[i].writable = in[2];
    in += 8;
    S->accounts[i].key = in; in += 32;
    S->accounts[i].owner = in; in += 32;
    in += 8;                                    /* lamports */
    S->accounts[i].data_len = le64(in); in += 8;
    S->accounts[i].data = (u8 *)in;
    in += S->accounts[i].data_len + 10240;      /* data, then the room Solana reserves for growth */
    in += (8 - ((u64)in & 7)) & 7;
    in += 8;                                    /* rent epoch */
  }
  ix_len = le64(in); in += 8; ix = in; in += ix_len;
  S->program_id = in;
  if (ix_len < 1) return 102;
  S->op = ix[0];
  if (S->op == OP_DRAW) return draw();
  if (S->op != OP_LOCK && S->op != OP_CHECK) return 103;

  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  (void)UploadServer(NULL, S->supported, &S->transport);
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil draw: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED fails the transaction, so nothing is written. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}
