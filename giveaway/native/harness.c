// Runs the giveaway program on an ordinary machine, for tests. It plays the part of Solana:
// it lays out the accounts and instruction data the way Solana does, supplies the four calls the
// program makes into Solana (log, log numbers, SHA-256, clock), and prints what happened.
//
// Input on stdin, one item per line:
//   slot N | time N | program HEX | account KEYHEX OWNERHEX FLAG DATAHEX|- [LAMPORTS] | ix HEX
//   FLAG is 0 (read-only), 1 (writable) or 2 (writable and a signer of the transaction).
// Output: LOG lines, then RET <code>, then ACCOUNT <index> <hex> and LAMPORTS <index> <n> for each account.
//
// It also stands in for Solana's token program, for the one instruction the burn vault uses
// (Burn), following the rules the real program enforces. The workflow repeats those tests
// against the real token program on a local Solana validator.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

extern uint64_t entrypoint(const uint8_t *input);
static uint64_t now_slot = 1000, now_time = 1700000000;

void sol_log_(const char *m, uint64_t n) { printf("LOG %.*s\n", (int)n, m); }
void sol_log_64_(uint64_t a, uint64_t b, uint64_t c, uint64_t d, uint64_t e) { printf("LOG 0x%llx, 0x%llx, 0x%llx, 0x%llx, 0x%llx\n", (unsigned long long)a, (unsigned long long)b, (unsigned long long)c, (unsigned long long)d, (unsigned long long)e); }
struct sol_clock { uint64_t slot; int64_t epoch_start; uint64_t epoch; uint64_t leader_epoch; int64_t unix_time; };
uint64_t sol_get_clock_sysvar(struct sol_clock *c) { memset(c, 0, sizeof *c); c->slot = now_slot; c->unix_time = (int64_t)now_time; return 0; }

// SHA-256 (FIPS 180-4), small and plain.
static const uint32_t K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
static void sha256(const uint8_t *msg, size_t len, uint8_t out[32]) {
  uint32_t h[8] = { 0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19 };
  size_t total = ((len + 9 + 63) / 64) * 64;
  uint8_t *buf = calloc(total, 1);
  memcpy(buf, msg, len); buf[len] = 0x80;
  for (int i = 0; i < 8; i++) buf[total - 1 - i] = (uint8_t)(((uint64_t)len * 8) >> (8 * i));
  for (size_t off = 0; off < total; off += 64) {
    uint32_t w[64], a[8];
    for (int i = 0; i < 16; i++) w[i] = ((uint32_t)buf[off + 4*i] << 24) | ((uint32_t)buf[off + 4*i + 1] << 16) | ((uint32_t)buf[off + 4*i + 2] << 8) | buf[off + 4*i + 3];
    for (int i = 16; i < 64; i++) { uint32_t s0 = ROR(w[i-15], 7) ^ ROR(w[i-15], 18) ^ (w[i-15] >> 3), s1 = ROR(w[i-2], 17) ^ ROR(w[i-2], 19) ^ (w[i-2] >> 10); w[i] = w[i-16] + s0 + w[i-7] + s1; }
    memcpy(a, h, sizeof a);
    for (int i = 0; i < 64; i++) {
      uint32_t s1 = ROR(a[4], 6) ^ ROR(a[4], 11) ^ ROR(a[4], 25), ch = (a[4] & a[5]) ^ (~a[4] & a[6]), t1 = a[7] + s1 + ch + K[i] + w[i];
      uint32_t s0 = ROR(a[0], 2) ^ ROR(a[0], 13) ^ ROR(a[0], 22), mj = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]), t2 = s0 + mj;
      a[7] = a[6]; a[6] = a[5]; a[5] = a[4]; a[4] = a[3] + t1; a[3] = a[2]; a[2] = a[1]; a[1] = a[0]; a[0] = t1 + t2;
    }
    for (int i = 0; i < 8; i++) h[i] += a[i];
  }
  for (int i = 0; i < 8; i++) { out[4*i] = (uint8_t)(h[i] >> 24); out[4*i + 1] = (uint8_t)(h[i] >> 16); out[4*i + 2] = (uint8_t)(h[i] >> 8); out[4*i + 3] = (uint8_t)h[i]; }
  free(buf);
}
struct sol_bytes { const uint8_t *addr; uint64_t len; };
uint64_t sol_sha256(const struct sol_bytes *parts, uint64_t count, uint8_t *out) {
  size_t total = 0, at = 0;
  for (uint64_t i = 0; i < count; i++) total += parts[i].len;
  uint8_t *all = malloc(total ? total : 1);
  for (uint64_t i = 0; i < count; i++) { memcpy(all + at, parts[i].addr, parts[i].len); at += parts[i].len; }
  sha256(all, total, out);
  free(all);
  return 0;
}

// ---- calling another program: only the token programs' Burn is modelled ----
struct sol_meta { const uint8_t *pubkey; _Bool is_writable; _Bool is_signer; };
struct sol_instruction { const uint8_t *program_id; struct sol_meta *accounts; uint64_t account_len; uint8_t *data; uint64_t data_len; };
struct sol_account_info { const uint8_t *key; uint64_t *lamports; uint64_t data_len; uint8_t *data; const uint8_t *owner; uint64_t rent_epoch; _Bool is_signer; _Bool is_writable; _Bool executable; };
static const uint8_t TOKEN[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93, 0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac, 0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91, 0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9 };
static const uint8_t TOKEN_2022[32] = { 0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde, 0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda, 0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27, 0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc };
uint64_t sol_invoke_signed_c(const struct sol_instruction *ix, const struct sol_account_info *infos, int n, const void *seeds, int seed_count) {
  const struct sol_account_info *found[3] = { 0, 0, 0 };
  uint64_t amount, held, supply;
  (void)seeds; (void)seed_count;
  if (memcmp(ix->program_id, TOKEN, 32) && memcmp(ix->program_id, TOKEN_2022, 32)) { printf("LOG (harness) call to a program that is not modelled\n"); return 1; }
  if (ix->data_len != 9 || ix->data[0] != 8 || ix->account_len != 3) { printf("LOG (harness) only Burn is modelled\n"); return 1; }
  for (int m = 0; m < 3; m++) for (int i = 0; i < n; i++) if (!memcmp(infos[i].key, ix->accounts[m].pubkey, 32)) { found[m] = &infos[i]; break; }
  if (!found[0] || !found[1] || !found[2]) return 2;
  // A token account: mint 0..32, owner 32..64, amount 64..72. A mint: supply at 36..44.
  if (found[0]->data_len < 72 || found[1]->data_len < 44) return 3;
  if (memcmp(found[0]->owner, ix->program_id, 32) || memcmp(found[1]->owner, ix->program_id, 32)) return 4;     /* both belong to this token program */
  if (memcmp(found[0]->data, found[1]->key, 32)) return 5;                                                       /* the account holds this coin */
  if (memcmp(found[0]->data + 32, found[2]->key, 32) || !found[2]->is_signer || !ix->accounts[2].is_signer) return 6;   /* its owner signed */
  if (!found[0]->is_writable || !found[1]->is_writable) return 7;
  memcpy(&amount, ix->data + 1, 8); memcpy(&held, found[0]->data + 64, 8); memcpy(&supply, found[1]->data + 36, 8);
  if (held < amount) { printf("LOG (token program) insufficient funds\n"); return 8; }
  held -= amount; supply -= amount;
  memcpy(found[0]->data + 64, &held, 8); memcpy(found[1]->data + 36, &supply, 8);
  return 0;
}

static size_t unhex(const char *s, uint8_t *out) { size_t n = 0; if (s[0] == '-') return 0; for (; s[0] && s[1] && s[0] != '\n'; s += 2) { unsigned v; sscanf(s, "%2x", &v); out[n++] = (uint8_t)v; } return n; }

int main(void) {
  static char line[200000];
  static uint8_t input[400000], ix[4096], program[32], tmp[100000];
  uint8_t *accounts[8]; uint8_t *lamports[8]; size_t lens[8]; int n = 0;
  uint8_t *p = input + 8;
  size_t ix_len = 0;
  if (mmap((void *)0x300000000UL, 32768, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED, -1, 0) == MAP_FAILED) { perror("mmap"); return 2; }
  while (fgets(line, sizeof line, stdin)) {
    char *sp = strchr(line, ' ');
    if (!sp) continue;
    *sp++ = 0;
    if (!strcmp(line, "slot")) now_slot = strtoull(sp, NULL, 10);
    else if (!strcmp(line, "time")) now_time = strtoull(sp, NULL, 10);
    else if (!strcmp(line, "program")) unhex(sp, program);
    else if (!strcmp(line, "ix")) ix_len = unhex(sp, ix);
    else if (!strcmp(line, "account")) {
      char *key = strtok(sp, " \n"), *owner = strtok(NULL, " \n"), *w = strtok(NULL, " \n"), *data = strtok(NULL, " \n"), *lam = strtok(NULL, " \n");
      size_t len = unhex(data, tmp);
      uint64_t balance = lam ? strtoull(lam, NULL, 10) : 1;
      p[0] = 0xff; p[1] = (uint8_t)(w[0] == '2'); p[2] = (uint8_t)(w[0] == '1' || w[0] == '2'); p[3] = 0; p += 8;
      unhex(key, p); p += 32; unhex(owner, p); p += 32;
      memcpy(p, &balance, 8); lamports[n] = p; p += 8;
      uint64_t l = len; memcpy(p, &l, 8); p += 8;
      accounts[n] = p; lens[n] = len; n++;
      memcpy(p, tmp, len); p += len + 10240;
      p += (8 - ((uintptr_t)p & 7)) & 7;
      p += 8;
    }
  }
  uint64_t count = (uint64_t)n; memcpy(input, &count, 8);
  uint64_t l = ix_len; memcpy(p, &l, 8); p += 8; memcpy(p, ix, ix_len); p += ix_len; memcpy(p, program, 32);
  uint64_t ret = entrypoint(input);
  printf("RET %llu\n", (unsigned long long)ret);
  for (int i = 0; i < n; i++) { printf("ACCOUNT %d ", i); for (size_t j = 0; j < lens[i]; j++) printf("%02x", accounts[i][j]); printf("\n"); }
  for (int i = 0; i < n; i++) { uint64_t v; memcpy(&v, lamports[i], 8); printf("LAMPORTS %d %llu\n", i, (unsigned long long)v); }
  return 0;
}
