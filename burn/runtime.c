// A Solana runtime for Phil's upload server, used as the gatekeeper of a burn vault.
//
// A burn vault holds a coin's fees, in SOL. It has one rule, fixed when the vault is opened:
// whoever burns `threshold` of the coin receives everything the vault holds. The moment the fees
// are worth more than that many coins, it pays someone to buy the coins on the market and burn
// them, so fees turn into burned supply. There is no instruction that withdraws, and no owner.
//
// Both instructions are uploads through `UploadServer`, the function Phil's LLVM backend emits
// (see giveaway/runtime.c for how that interface is met on Solana; the frame and digest code
// here is the same). OPEN uploads the vault's rule. BURN uploads an offer: "I will burn the
// threshold now, provided the vault pays at least this much". If Phil's server accepts the
// upload, the "store" step carries it out: it has Solana's token program burn the coins, and
// only then moves the SOL. Anything else fails the whole transaction.
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
// Calling another program. These three layouts are Solana's C interface.
struct sol_meta { const u8 *pubkey; bool is_writable; bool is_signer; };
struct sol_instruction { const u8 *program_id; struct sol_meta *accounts; u64 account_len; u8 *data; u64 data_len; };
struct sol_account_info { const u8 *key; u64 *lamports; u64 data_len; u8 *data; const u8 *owner; u64 rent_epoch; bool is_signer; bool is_writable; bool executable; };
extern u64 sol_invoke_signed_c(const struct sol_instruction *instruction, const struct sol_account_info *infos, int info_count, const void *signer_seeds, int seed_count);

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
enum { OP_OPEN = 1, OP_BURN = 2 };
enum { NONE = 0, ACCEPTED = 1, REJECTED = 2, UNSUPPORTED = 3, POLICY_REJECTED = 4, CANCELLED = 5,
       RECOGNITION_FAILED = 6, HELLO_POLICY_FAILED = 7, STORAGE_FAILED = 8, EARLY_EOF = 9 };
enum { POLICY_TOO_LONG = 1, POLICY_WRONG_KIND = 2, POLICY_ALREADY_OPEN = 3, POLICY_BAD_VAULT = 4, POLICY_NOT_OPEN = 5 };
enum { STORE_BAD_RECORD = 1, STORE_BAD_RULE = 2, STORE_WRONG_COIN = 3, STORE_NOT_A_TOKEN_PROGRAM = 4, STORE_NOT_SIGNED = 5,
       STORE_NOTHING_TO_PAY = 6, STORE_PAYS_TOO_LITTLE = 7, STORE_BURN_FAILED = 8, STORE_BAD_ACCOUNTS = 9 };
#define MAX_PAYLOAD 128u
static const char KIND_OPEN[] = "phil-burn/open";
static const char KIND_OFFER[] = "phil-burn/offer";
static const u8 TOKEN_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93, 0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac, 0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91, 0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9 };
static const u8 TOKEN_2022_PROGRAM[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde, 0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda, 0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27, 0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc };

// ---- the vault account: 256 bytes ----
enum { EMPTY = 0, OPEN = 1 };
#define VAULT_SIZE 256u
#define V_MAGIC 0          /* "PHILBURN" */
#define V_STATE 8
#define V_LABEL_LEN 9
#define V_THRESHOLD 16     /* u64: coins (smallest units) to burn to take the pot */
#define V_RESERVE 24       /* u64: lamports that stay, so Solana keeps the account */
#define V_MINT 32          /* the coin */
#define V_OPENED_SLOT 64
#define V_OPENED_TIME 72
#define V_BURNS 80         /* u64: how many times the pot was taken */
#define V_TOTAL_BURNED 88  /* u64: coins burned, smallest units */
#define V_TOTAL_PAID 96    /* u64: lamports paid out */
#define V_LAST_SLOT 104
#define V_LAST_TIME 112
#define V_LAST_PAID 120
#define V_RULE_DIGEST 128  /* what Phil's server validated at OPEN */
#define V_LABEL 160        /* up to 32 bytes */

// ---- working state, in the heap region ----
struct transport { const u8 *bytes; u64 available; u64 cursor; };
struct frame { const u8 *bytes; u64 length; u8 tag; u8 problem; };
struct hello { const u8 *versions; u16 count; };
struct begin { u64 length; const u8 *kind; const u8 *digest; u8 kind_len; };
struct payload { const u8 *bytes; u64 length; u8 held; };
struct state {
  struct sol_account_info accounts[6];
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
#define S ((struct state *)0x300000000UL)

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
  struct sol_account_info *vault = &S->accounts[0];
  const char *kind = S->op == OP_OPEN ? KIND_OPEN : KIND_OFFER;
  u64 kind_len = S->op == OP_OPEN ? sizeof(KIND_OPEN) - 1 : sizeof(KIND_OFFER) - 1;
  u8 why = 0;
  (void)policy_context;
  if (b->length > MAX_PAYLOAD) why = POLICY_TOO_LONG;
  else if (b->kind_len != kind_len || !same(b->kind, (const u8 *)kind, kind_len)) why = POLICY_WRONG_KIND;
  else if (S->account_count < 1 || vault->data_len < VAULT_SIZE || !vault->is_writable || !same(vault->owner, S->program_id, 32)) why = POLICY_BAD_VAULT;
  else if (S->op == OP_OPEN && vault->data[V_STATE] != EMPTY) why = POLICY_ALREADY_OPEN;
  else if (S->op == OP_BURN && vault->data[V_STATE] != OPEN) why = POLICY_NOT_OPEN;
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

// OPEN. The rule that is uploaded: "BURN1", the coin's mint (32 bytes), threshold u64, label length u8, label.
static u8 open_vault(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0];
  const u8 *r = p->bytes;
  struct sol_clock clock;
  u8 *d = vault->data;
  if (p->length < 46 || !same(r, (const u8 *)"BURN1", 5) || r[45] > 32 || p->length != 46u + r[45]) return STORE_BAD_RECORD;
  if (le64(r + 37) == 0) return STORE_BAD_RULE;
  sol_get_clock_sysvar(&clock);
  memset(d, 0, VAULT_SIZE);
  memcpy(d + V_MAGIC, "PHILBURN", 8);
  d[V_STATE] = OPEN; d[V_LABEL_LEN] = r[45];
  memcpy(d + V_THRESHOLD, r + 37, 8);
  put64(d + V_RESERVE, *vault->lamports);        /* what is here now stays; everything that arrives later is the pot */
  memcpy(d + V_MINT, r + 5, 32);
  put64(d + V_OPENED_SLOT, clock.slot); put64(d + V_OPENED_TIME, (u64)clock.unix_time);
  memcpy(d + V_RULE_DIGEST, S->computed, 32);
  memcpy(d + V_LABEL, r + 46, r[45]);
  LOG("Phil burn: vault opened. Its rule can never be changed, and it has no way to withdraw");
  return 0;
}

// BURN. The offer that is uploaded: "BOFF1", then the least the sender will accept, u64 lamports.
// Accounts: vault, the coin's mint, the sender's token account, the sender (signs), the token program.
static u8 burn_and_pay(struct payload *p) {
  struct sol_account_info *vault = &S->accounts[0], *mint = &S->accounts[1], *tokens = &S->accounts[2], *sender = &S->accounts[3], *program = &S->accounts[4];
  u8 *d = vault->data;
  u64 threshold, reserve, pot, least;
  struct sol_clock clock;
  if (p->length != 13 || !same(p->bytes, (const u8 *)"BOFF1", 5)) return STORE_BAD_RECORD;
  if (S->account_count < 5) return STORE_BAD_ACCOUNTS;
  if (!same(mint->key, d + V_MINT, 32)) return STORE_WRONG_COIN;
  // The burn must be done by one of Solana's two real token programs, and it must be the one this coin belongs to.
  if (!(same(program->key, TOKEN_PROGRAM, 32) || same(program->key, TOKEN_2022_PROGRAM, 32)) || !same(mint->owner, program->key, 32) || !same(tokens->owner, program->key, 32)) return STORE_NOT_A_TOKEN_PROGRAM;
  if (!sender->is_signer || !sender->is_writable) return STORE_NOT_SIGNED;
  if (same(sender->key, vault->key, 32) || same(tokens->key, vault->key, 32) || same(mint->key, vault->key, 32)) return STORE_BAD_ACCOUNTS;
  threshold = le64(d + V_THRESHOLD); reserve = le64(d + V_RESERVE); least = le64(p->bytes + 5);
  if (*vault->lamports <= reserve) return STORE_NOTHING_TO_PAY;
  pot = *vault->lamports - reserve;
  if (pot < least) return STORE_PAYS_TOO_LITTLE;
  {
    // Token instruction 8 is Burn: [token account, mint, owner who signs], then the amount.
    u8 data[9];
    struct sol_meta metas[3] = { { tokens->key, 1, 0 }, { mint->key, 1, 0 }, { sender->key, 0, 1 } };
    struct sol_instruction burn = { program->key, metas, 3, data, 9 };
    struct sol_account_info infos[4];
    data[0] = 8; put64(data + 1, threshold);
    infos[0] = *tokens; infos[1] = *mint; infos[2] = *sender; infos[3] = *program;
    if (sol_invoke_signed_c(&burn, infos, 4, NULL, 0) != 0) return STORE_BURN_FAILED;
  }
  LOG("Phil burn: the token program burned the coins");
  // Only now does the SOL move. The vault keeps its reserve.
  *vault->lamports -= pot;
  *sender->lamports += pot;
  sol_get_clock_sysvar(&clock);
  put64(d + V_BURNS, le64(d + V_BURNS) + 1);
  put64(d + V_TOTAL_BURNED, le64(d + V_TOTAL_BURNED) + threshold < threshold ? ~0UL : le64(d + V_TOTAL_BURNED) + threshold);
  put64(d + V_TOTAL_PAID, le64(d + V_TOTAL_PAID) + pot);
  put64(d + V_LAST_SLOT, clock.slot); put64(d + V_LAST_TIME, (u64)clock.unix_time); put64(d + V_LAST_PAID, pot);
  LOG("Phil burn: BURNED. Coins burned, then lamports paid:");
  sol_log_64_(0, 0, 0, threshold, pot);
  return 0;
}

u8 phil_runtime_store_with_error(void *payload, void **upload_id_out, void **storage_error_out) {
  struct payload *p = payload;
  u8 why = S->op == OP_OPEN ? open_vault(p) : burn_and_pay(p);
  *storage_error_out = &S->reason;
  if (why) { S->reason = why; return 0; }
  p->held = 0;
  *upload_id_out = (void *)S->accounts[0].key;
  return 1;
}
void phil_runtime_fail_storage(void *transport, void *storage_error) { (void)transport; (void)storage_error; S->outcome = STORAGE_FAILED; LOG("Phil: the upload was valid but could not be carried out"); }
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

// ================= Solana's entry point =================
u64 entrypoint(const u8 *input) {
  const u8 *in = input;
  const u8 *ix; u64 ix_len;
  u64 n = le64(in); in += 8;
  if (n > 6) return 101;
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
  if (S->op != OP_OPEN && S->op != OP_BURN) return 103;

  S->transport.bytes = ix + 1; S->transport.available = ix_len - 1; S->transport.cursor = 0;
  S->supported[0] = 1; S->supported[1] = 1;     /* one version: 1 */
  LOG("Phil: UploadServer started");
  (void)UploadServer(NULL, S->supported, &S->transport);
  if (S->outcome == ACCEPTED && S->transport.cursor != S->transport.available) { LOG("Phil burn: refused, bytes left over after the upload"); return 120; }
  if (S->outcome == ACCEPTED) return 0;
  // Anything but ACCEPTED fails the transaction, so nothing is burned or paid. The number says why.
  return 1000u + 100u * (S->outcome ? S->outcome : EARLY_EOF) + S->reason;
}
