// "Hacks Phil would have stopped": well-known incidents, each reduced to the shape of the mistake
// and written in Phil. Every program here is a test: `broken` must fail with `kind`, `fixed` must run.
// These are not the original contracts. They show that the same kind of mistake is refused.

export interface Hack {
  id: string; year: string; name: string; loss: string;
  happened: string;                    // what happened, in our words
  sources: { label: string; url: string }[];
  shape: string;                       // the mistake in one sentence
  kind: "linearity" | "arithmetic" | "contract";
  why: string;                         // why Phil refuses it
  broken: string; fixed: string;
  inputs?: Record<string, string>; fixedInputs?: Record<string, string>;
  fixNote: string;
}

export const HACKS: Hack[] = [
  {
    id: "dao", year: "2016", name: "The DAO", loss: "about 3.6 million ETH",
    happened: "The DAO was an investment fund run by a contract. Its withdrawal code paid out first and updated its records afterwards, so an attacker asked for the same withdrawal again and again before the books caught up. About 3.6 million ETH, roughly a third of the fund, was drained, and Ethereum split in two over how to respond.",
    sources: [
      { label: "The Block, on the tenth anniversary", url: "https://www.theblock.co/post/405248/ethereum-130-million-security-fund-the-dao-hack-10-years" },
      { label: "P2P Foundation wiki", url: "https://wiki.p2pfoundation.net/DAO_Hack" },
    ],
    shape: "The same balance was paid out more than once.",
    kind: "linearity",
    why: "In The DAO a balance was a number in a table, and a number can be read as often as you like. In Phil a deposit is a thing. Paying it out uses it up, so there is nothing left to pay out a second time, whatever order the code runs in.",
    broken: `record Deposit mode linear {
  amount : U64
}

callable Withdraw(deposit : Deposit) -> U64 {
  outcomes { success U64 };
}

fn withdraw(deposit : Deposit) -> U64 satisfies Withdraw {
  let Deposit { amount } = deposit;
  return amount;
}

component main provides U64 {
  let deposit = construct Deposit { amount = 100 };
  let first = withdraw(deposit);
  let again = withdraw(deposit);
  return first + again;
}
`,
    fixed: `record Deposit mode linear {
  amount : U64
}

callable Withdraw(deposit : Deposit) -> U64 {
  outcomes { success U64 };
}

fn withdraw(deposit : Deposit) -> U64 satisfies Withdraw {
  let Deposit { amount } = deposit;
  return amount;
}

component main provides U64 {
  let deposit = construct Deposit { amount = 100 };
  let paid = withdraw(deposit);
  return paid;
}
`,
    fixNote: "One deposit, one withdrawal.",
  },
  {
    id: "bec", year: "2018", name: "BeautyChain (BEC)", loss: "trading suspended",
    happened: "BEC's batch transfer multiplied the amount per receiver by the number of receivers to work out what the sender needed. With two receivers and an enormous amount, the multiplication wrapped around to a tiny number, the balance check passed, and each receiver was credited the enormous amount. It was exploited in April 2018 and recorded as CVE-2018-10299.",
    sources: [
      { label: "NVD, CVE-2018-10299", url: "https://nvd.nist.gov/vuln/detail/CVE-2018-10299" },
      { label: "CIRCL vulnerability record", url: "https://cve.circl.lu/cve/CVE-2018-10299" },
    ],
    shape: "A multiplication overflowed and wrapped around to a small number.",
    kind: "arithmetic",
    why: "Phil's numbers have a stated size and never wrap. A result that does not fit stops the program instead of quietly becoming a different number. There is nothing for the programmer to remember to check.",
    inputs: { receivers: "2", each: "9223372036854775808" },
    fixedInputs: { receivers: "2", each: "1000" },
    broken: `// What the sender must hold to send \`each\` tokens to every receiver.
callable Needed(receivers : U64, each : U64) -> U64 {
  outcomes { success U64 };
}

fn needed(receivers : U64, each : U64) -> U64 satisfies Needed {
  return receivers * each;
}

component main(receivers : U64, each : U64) provides U64 {
  let total = needed(receivers, each);
  console_write("the sender must hold", total);
  return total;
}
`,
    fixed: `// What the sender must hold to send \`each\` tokens to every receiver.
callable Needed(receivers : U64, each : U64) -> U64 {
  outcomes { success U64 };
}

fn needed(receivers : U64, each : U64) -> U64 satisfies Needed {
  return receivers * each;
}

component main(receivers : U64, each : U64) provides U64 {
  let total = needed(receivers, each);
  console_write("the sender must hold", total);
  return total;
}
`,
    fixNote: "The program is unchanged. With amounts that fit, it runs; with amounts that do not, it stops.",
  },
  {
    id: "wormhole", year: "2022", name: "Wormhole bridge", loss: "120,000 wETH, over $320 million",
    happened: "Wormhole let people lock ETH on one chain and receive wrapped ETH on Solana. A flaw in how the Solana side checked signatures let an attacker present a message saying 120,000 ETH had been deposited when it had not. The bridge believed the message and minted 120,000 wrapped ETH with nothing behind it.",
    sources: [
      { label: "CertiK incident analysis", url: "https://www.certik.com/blog/wormhole-bridge-exploit-incident-analysis" },
      { label: "Halborn, Explained: the Wormhole hack", url: "https://halborn.com/explained-the-wormhole-hack-february-2022/" },
    ],
    shape: "Tokens were minted on the strength of a claim, not a deposit.",
    kind: "contract",
    why: "Here minting takes the locked deposit itself, not a message about one, and promises in writing that the amount minted equals the amount locked. A claim of 120,000 against a deposit of 1 breaks that promise and the program stops. Phil does not check signatures for you; it makes “minted equals locked” a rule that cannot be skipped.",
    broken: `record Locked mode linear {
  amount : U64
}

record Wrapped mode linear {
  amount : U64
}

// Wrapped tokens only come into being against the deposit that backs them.
callable Mint(backing : Locked, claimed : U64) -> Wrapped {
  requires backing.amount == claimed;
  outcomes { success Wrapped };
}

fn mint(backing : Locked, claimed : U64) -> Wrapped satisfies Mint {
  let Locked { amount } = backing;
  return construct Wrapped { amount = claimed };
}

component main provides Wrapped {
  let deposit = construct Locked { amount = 1 };
  return mint(deposit, 120000);
}
`,
    fixed: `record Locked mode linear {
  amount : U64
}

record Wrapped mode linear {
  amount : U64
}

// Wrapped tokens only come into being against the deposit that backs them.
callable Mint(backing : Locked, claimed : U64) -> Wrapped {
  requires backing.amount == claimed;
  outcomes { success Wrapped };
}

fn mint(backing : Locked, claimed : U64) -> Wrapped satisfies Mint {
  let Locked { amount } = backing;
  return construct Wrapped { amount = claimed };
}

component main provides Wrapped {
  let deposit = construct Locked { amount = 120000 };
  return mint(deposit, 120000);
}
`,
    fixNote: "The deposit matches the claim, so the mint goes through.",
  },
  {
    id: "akutars", year: "2022", name: "Akutars auction", loss: "11,539.5 ETH, about $34 million, locked for good",
    happened: "Nobody stole anything here. The auction contract would only release the sale proceeds once a refund counter reached a certain total, and because of a counting mistake it never could. 11,539.5 ETH was left inside the contract permanently, out of reach of the buyers and the team alike.",
    sources: [
      { label: "Halborn, Explained: the Akutars NFT incident", url: "https://www.halborn.com/blog/post/explained-the-akutars-nft-incident-april-2022" },
      { label: "Decrypt", url: "https://decrypt.co/98530/aku-ethereum-nft-launch-ends-with-34m-locked-in-flawed-smart-contract" },
    ],
    shape: "On one path through the code, the money had no way out.",
    kind: "linearity",
    why: "Phil counts “lost” as an error just as it counts “copied”. Every path through a program has to hand each coin to someone. A branch that ends while still holding the proceeds is refused, so the stuck path is found when the code is written, not after the sale. The counts below are made up for illustration.",
    inputs: { refunds_done: "3", bids: "5" },
    broken: `record Eth mode linear {
  amount : U64
}

component main(refunds_done : U64, bids : U64) provides U64 {
  let proceeds = construct Eth { amount = 11539 };
  if eq(refunds_done, bids) {
    let Eth { amount } = proceeds;
    return amount;
  } else {
    return 0;
  };
}
`,
    fixed: `record Eth mode linear {
  amount : U64
}

component main(refunds_done : U64, bids : U64) provides Eth {
  let proceeds = construct Eth { amount = 11539 };
  if eq(refunds_done, bids) {
    console_write("refunds finished, releasing proceeds");
    return proceeds;
  } else {
    console_write("refunds not finished, proceeds stay with their owner");
    return proceeds;
  };
}
`,
    fixNote: "Both branches hand the proceeds to someone. Phil accepts the program only once no path strands them.",
  },
];

/** Losses Phil's guarantees do not cover. Named so the page does not over-claim. */
export const NOT_STOPPED = [
  "Stolen or leaked signing keys. If the attacker holds the key, the program is doing what it was told.",
  "People tricked into approving a transaction they did not understand.",
  "Bad prices from outside: a contract that trusts a manipulated price feed is following its rules.",
  "A wrong rule written down correctly. Phil checks that the code keeps its promises, not that the promises are the right ones.",
];
