import React, { useState } from "react";
import {
  BookOpen,
  Wallet,
  Briefcase,
  PlusCircle,
  FileText,
  CheckCircle,
  AlertTriangle,
  Shield,
  HammerIcon,
  User,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Zap,
  Lock,
  Clock,
  DollarSign,
  Award,
  ArrowRight,
} from "lucide-react";

/* ─── Collapsible Section ─── */
function Section({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
            {icon}
          </div>
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400" />
        )}
      </button>
      {open && <div className="mt-4 space-y-3 text-sm text-gray-600">{children}</div>}
    </div>
  );
}

/* ─── Step Card ─── */
function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold">
        {number}
      </div>
      <div className="flex-1">
        <p className="font-medium text-gray-800 mb-1">{title}</p>
        <div className="text-gray-500 text-sm">{children}</div>
      </div>
    </div>
  );
}

/* ─── Info Box ─── */
function InfoBox({
  type,
  children,
}: {
  type: "info" | "warning" | "tip";
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
    tip: "bg-green-50 border-green-200 text-green-800",
  };
  const icons = {
    info: <Zap className="h-4 w-4 flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />,
    tip: <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />,
  };
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${styles[type]}`}>
      {icons[type]}
      <div>{children}</div>
    </div>
  );
}

/* ─── Table ─── */
function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2 text-left font-medium text-gray-700"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2 text-gray-600">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Flow Diagram ─── */
function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <span className="inline-block rounded-lg bg-brand-50 border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-700">
            {step}
          </span>
          {i < steps.length - 1 && (
            <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main UserGuide Page
   ═══════════════════════════════════════════ */
export default function UserGuide() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2 mb-8">
        <div className="flex justify-center">
          <div className="rounded-full bg-brand-100 p-4">
            <BookOpen className="h-8 w-8 text-brand-600" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">User Guide</h1>
        <p className="text-gray-500 max-w-2xl mx-auto">
          Everything you need to know to use GigSecure — the decentralized
          freelance escrow platform. This guide covers wallet setup, posting
          jobs, applying as a freelancer, managing milestones, resolving
          disputes, and more.
        </p>
      </div>

      {/* Table of Contents */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          📑 Table of Contents
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {[
            ["What is GigSecure?", "overview"],
            ["Getting Started", "getting-started"],
            ["Wallet & USDC", "wallet"],
            ["Posting a Job (Client)", "post-job"],
            ["Browsing & Applying (Freelancer)", "apply-job"],
            ["Job Lifecycle", "lifecycle"],
            ["Milestone Management", "milestones"],
            ["Disputes & Resolution", "disputes"],
            ["Reputation System", "reputation"],
            ["Judge Panel", "judge"],
            ["Admin Panel", "admin"],
            ["Security & Privacy", "security"],
            ["FAQ", "faq"],
          ].map(([label, id]) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-brand-600 hover:underline flex items-center gap-1"
            >
              <ChevronRight className="h-3 w-3" />
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* ─── 1. What is GigSecure ─── */}
      <div id="overview">
        <Section
          title="What is GigSecure?"
          icon={<Briefcase className="h-5 w-5" />}
          defaultOpen
        >
          <p>
            <strong>GigSecure</strong> (project name: ChainLancer) is a
            decentralized freelance escrow platform built on Ethereum smart
            contracts. It enables trustless collaboration between clients and
            freelancers by using blockchain-based escrow to hold funds until work
            is verified and approved.
          </p>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Key Features
          </h3>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>
              <strong>Milestone-based Escrow</strong> — Funds are locked in a
              smart contract and released per milestone upon approval.
            </li>
            <li>
              <strong>On-chain Dispute Resolution</strong> — Built-in 3-party
              arbitration system with evidence submission and judge rulings.
            </li>
            <li>
              <strong>Reputation System</strong> — On-chain reputation scores
              and tier badges (New → Bronze → Silver → Gold) for both
              clients and freelancers.
            </li>
            <li>
              <strong>End-to-End Encryption</strong> — All agreements,
              proposals, and deliverables are encrypted using hybrid AES +
              public-key cryptography before being stored on IPFS.
            </li>
            <li>
              <strong>Behavior Bonds</strong> — Both parties stake deposits to
              incentivize honest behavior. Deposit rates decrease with higher
              reputation tiers.
            </li>
            <li>
              <strong>USDC Payments</strong> — All payments are in USDC
              stablecoin. A 2% platform fee is charged on completed milestones.
            </li>
          </ul>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">Roles</h3>
          <SimpleTable
            headers={["Role", "Description"]}
            rows={[
              [
                "Client",
                "Posts jobs, funds escrow, reviews milestones, and approves/rejects deliverables.",
              ],
              [
                "Freelancer",
                "Browses jobs, applies with proposals, submits milestone deliverables, and collects payment.",
              ],
              [
                "Judge",
                "Reviews disputes, examines evidence, and issues binding rulings. Requires PLATFORM_JUDGE role.",
              ],
              [
                "Admin",
                "Manages roles, assigns judges, and can pause/unpause the platform in emergencies.",
              ],
            ]}
          />
        </Section>
      </div>

      {/* ─── 2. Getting Started ─── */}
      <div id="getting-started">
        <Section
          title="Getting Started"
          icon={<Zap className="h-5 w-5" />}
          defaultOpen
        >
          <h3 className="font-semibold text-gray-700 mb-2">Prerequisites</h3>
          <ul className="list-disc list-inside space-y-1 text-gray-600 mb-4">
            <li>
              <strong>Google Chrome</strong> browser (MetaMask requires Chrome)
            </li>
          </ul>

          <h3 className="font-semibold text-gray-700 mb-2">Quick Start</h3>
          <div className="space-y-4">
            <Step number={1} title="Install MetaMask">
              Install the MetaMask browser extension from the Chrome Web Store
              and create or import a wallet.
            </Step>
            <Step number={2} title="Connect Your Wallet">
              Click the <strong>"Connect Wallet"</strong> button in the top-right
              corner of the navigation bar. MetaMask will prompt you to approve
              the connection.
            </Step>
            <Step number={3} title="Switch Network">
              The app will prompt you to switch to the correct network (Base
              Sepolia testnet). Approve the network switch in MetaMask.
            </Step>
            <Step number={4} title="Get Test Funds">
              Navigate to the <strong>Wallet</strong> page and use the{" "}
              <strong>Faucet</strong> to mint test USDC. You'll also need test ETH
              from{" "}
              <a
                href="https://app.optimism.io/faucet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline"
              >
                Superchain Faucet
              </a>{" "}
              for gas fees.
            </Step>
            <Step number={5} title="Start Using the Platform">
              You're all set! Post a job as a client or browse available jobs as a
              freelancer.
            </Step>
          </div>
        </Section>
      </div>

      {/* ─── 3. Wallet & USDC ─── */}
      <div id="wallet">
        <Section title="Wallet & USDC" icon={<Wallet className="h-5 w-5" />}>
          <p>
            The <strong>Wallet</strong> page is your financial hub on GigSecure.
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            USDC Balance
          </h3>
          <p>
            Your current USDC token balance is displayed at the top. All
            transactions on the platform use USDC (a USD-pegged stablecoin).
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            Approving USDC Spending
          </h3>
          <p>
            Before you can post a job or stake a deposit, you need to{" "}
            <strong>approve</strong> the JobEscrow smart contract to spend your
            USDC. This is a standard ERC-20 approval — you stay in control of
            your tokens and can revoke approval at any time.
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            Withdrawable Balance
          </h3>
          <p>
            Funds from completed milestones, refunds, or returned deposits
            accumulate in your <strong>withdrawable balance</strong> inside the
            escrow contract. Click <strong>"Withdraw"</strong> to transfer them
            to your wallet.
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            Test Faucet
          </h3>
          <p>
            On testnet, the built-in faucet lets you mint free USDC for testing.
            Simply enter an amount and click <strong>"Mint USDC"</strong>.
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            Encryption Keys
          </h3>
          <p>
            The Wallet page also shows your locally stored encryption keys for
            each job. These keys are used to decrypt agreements, proposals, and
            deliverables. They are stored only in your browser's local storage —
            if you clear your browser data, you will lose access to encrypted
            content.
          </p>

          <InfoBox type="warning">
            <strong>Important:</strong> Do not clear your browser local storage
            while you have active jobs. Your encryption keys are stored locally
            and cannot be recovered if deleted.
          </InfoBox>
        </Section>
      </div>

      {/* ─── 4. Posting a Job ─── */}
      <div id="post-job">
        <Section
          title="Posting a Job (Client)"
          icon={<PlusCircle className="h-5 w-5" />}
        >
          <p>
            As a client, you can create jobs with milestone-based payment
            structures. Here's how:
          </p>

          <div className="space-y-4 mt-3">
            <Step number={1} title="Fill Out Job Details">
              Provide a <strong>title</strong>, <strong>description</strong>, and{" "}
              <strong>technical requirements</strong>. Set a{" "}
              <strong>review timeout</strong> (how long you have to review each
              milestone submission before it auto-approves).
            </Step>
            <Step number={2} title="Define Milestones">
              Add one or more milestones. Each milestone has:
              <ul className="list-disc list-inside mt-1 ml-4">
                <li>
                  <strong>Value (USDC)</strong> — payment for this milestone
                </li>
                <li>
                  <strong>Deadline (days)</strong> — how long the freelancer has
                  to complete it
                </li>
                <li>
                  <strong>Description</strong> — what needs to be delivered
                </li>
              </ul>
            </Step>
            <Step number={3} title="Review Cost Summary">
              The form shows a cost breakdown:
              <ul className="list-disc list-inside mt-1 ml-4">
                <li>
                  <strong>Total Job Value</strong> = sum of all milestones
                </li>
                <li>
                  <strong>Behavior Bond</strong> = percentage based on your
                  reputation tier (7.5% for New, 5% for Bronze, 2.5% for Silver,
                  1% for Gold)
                </li>
                <li>
                  <strong>Total Required</strong> = Job Value + Behavior Bond
                </li>
              </ul>
            </Step>
            <Step number={4} title="Approve USDC & Post">
              Click <strong>"Approve USDC"</strong> to authorize the contract to
              spend your tokens, then click <strong>"Post Job"</strong>. The
              system will encrypt the job agreement, upload it to IPFS, and
              create the job on-chain.
            </Step>
          </div>

          <InfoBox type="info">
            Once posted, your job appears in the "Browse Jobs" page with an{" "}
            <strong>Open</strong> status, ready for freelancers to apply.
          </InfoBox>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Review Timeout Options
          </h3>
          <SimpleTable
            headers={["Duration", "Best For"]}
            rows={[
              ["1 day", "Simple, quick deliverables"],
              ["3 days", "Small tasks with clear requirements"],
              ["7 days (default)", "Most standard projects"],
              ["14 days", "Complex deliverables needing thorough review"],
              ["21–30 days", "Large enterprise projects"],
            ]}
          />
        </Section>
      </div>

      {/* ─── 5. Browsing & Applying ─── */}
      <div id="apply-job">
        <Section
          title="Browsing & Applying (Freelancer)"
          icon={<FileText className="h-5 w-5" />}
        >
          <h3 className="font-semibold text-gray-700 mb-2">
            Browsing Jobs
          </h3>
          <p>
            The <strong>Browse Jobs</strong> page lists all available jobs on the
            platform. You can:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-3">
            <li>
              <strong>Search</strong> by Job ID, client address, or freelancer
              address
            </li>
            <li>
              <strong>Filter</strong> by job status (Open, Applications, Active,
              Completed, Cancelled, Abandoned)
            </li>
          </ul>

          <h3 className="font-semibold text-gray-700 mb-2">
            Applying for a Job
          </h3>
          <div className="space-y-4">
            <Step number={1} title="Open Job Detail">
              Click on any open job card to view its details including
              milestones, total value, and the client's reputation.
            </Step>
            <Step number={2} title="Click Apply">
              Click <strong>"Apply for this Job"</strong> to navigate to the
              application form.
            </Step>
            <Step number={3} title="Write Your Proposal">
              Fill in your <strong>proposal</strong> (required),{" "}
              <strong>relevant experience</strong>, and{" "}
              <strong>estimated timeline</strong>.
            </Step>
            <Step number={4} title="Submit">
              Your proposal is encrypted end-to-end (only you and the client can
              read it), uploaded to IPFS, and recorded on-chain.
            </Step>
          </div>

          <InfoBox type="tip">
            Write compelling proposals! The client can see all applications and
            will select one freelancer to proceed.
          </InfoBox>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            After Being Selected
          </h3>
          <p>
            If the client selects you, you'll see a blue banner on the job
            detail page with two options:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>Confirm & Stake</strong> — Accept the job and stake your
              freelancer deposit (calculated based on your reputation tier).
            </li>
            <li>
              <strong>Reject Offer</strong> — Decline the offer, allowing the
              client to select a different freelancer.
            </li>
          </ul>
          <InfoBox type="warning">
            You must respond within the <strong>acceptance timeout</strong>{" "}
            period. If you don't respond in time, anyone can expire the offer
            and the client can select someone else.
          </InfoBox>
        </Section>
      </div>

      {/* ─── 6. Job Lifecycle ─── */}
      <div id="lifecycle">
        <Section
          title="Job Lifecycle"
          icon={<Clock className="h-5 w-5" />}
        >
          <p>Every job goes through a series of states:</p>
          <FlowDiagram
            steps={[
              "Open",
              "Applications",
              "Active",
              "Completed / Cancelled / Abandoned",
            ]}
          />

          <SimpleTable
            headers={["State", "Description", "What Happens"]}
            rows={[
              [
                "Open",
                "Job just created",
                "Freelancers can view and apply. Client has not yet selected anyone.",
              ],
              [
                "Applications",
                "Freelancer selected",
                "Client has selected a freelancer. Waiting for the freelancer to confirm & stake.",
              ],
              [
                "Active",
                "Work in progress",
                "Freelancer works on milestones. Both parties can submit, review, and interact.",
              ],
              [
                "Completed",
                "All milestones done",
                "All milestones are approved. Deposits returned, reputation updated.",
              ],
              [
                "Cancelled",
                "Job cancelled",
                "Either party initiated cancellation (before or during work). Refunds processed.",
              ],
              [
                "Abandoned",
                "Freelancer abandoned",
                "Freelancer did not meet deadlines. Client can recover funds.",
              ],
            ]}
          />

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Cancellation
          </h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>Before Active:</strong> Client can cancel directly (full
              refund of escrow and bond).
            </li>
            <li>
              <strong>During Active:</strong> Either party can{" "}
              <strong>request cancellation</strong>. The other party must{" "}
              <strong>accept</strong> for it to proceed. Completed milestones
              are still paid out.
            </li>
          </ul>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Expired Job Withdrawal
          </h3>
          <p>
            If a job stays in Open or Applications state for over{" "}
            <strong>14 days</strong> without any selected freelancer, the client
            can withdraw and close the job.
          </p>
        </Section>
      </div>

      {/* ─── 7. Milestone Management ─── */}
      <div id="milestones">
        <Section
          title="Milestone Management"
          icon={<CheckCircle className="h-5 w-5" />}
        >
          <p>
            Milestones are the building blocks of every job. Each milestone
            goes through its own lifecycle:
          </p>
          <FlowDiagram
            steps={[
              "Pending",
              "In Review",
              "Approved / Auto-Approved / Disputed",
            ]}
          />

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            For Freelancers
          </h3>
          <div className="space-y-3">
            <Step number={1} title="Submit Deliverable">
              For each milestone, upload your work by clicking{" "}
              <strong>"Submit Milestone"</strong>. Your deliverable is encrypted
              and stored on IPFS with a hash recorded on-chain.
            </Step>
            <Step number={2} title="Wait for Review">
              The client has until the <strong>review timeout</strong> to review
              your submission. You can see the countdown on the milestone card.
            </Step>
          </div>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            For Clients
          </h3>
          <div className="space-y-3">
            <Step number={1} title="Review Submission">
              View the submitted deliverable by clicking{" "}
              <strong>"View Deliverable"</strong> on the milestone. The content
              is decrypted locally using your job key.
            </Step>
            <Step number={2} title="Approve or Dispute">
              <ul className="list-disc list-inside ml-4">
                <li>
                  <strong>Approve</strong> — Releases the milestone payment to
                  the freelancer (minus 2% platform fee).
                </li>
                <li>
                  <strong>Raise Dispute</strong> — Opens a dispute if the work
                  doesn't meet requirements.
                </li>
              </ul>
            </Step>
          </div>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Auto-Approve
          </h3>
          <InfoBox type="info">
            If the client does not review a milestone within the{" "}
            <strong>review timeout</strong> period, anyone can trigger{" "}
            <strong>auto-approval</strong>. This protects freelancers from
            unresponsive clients. The milestone payment is released
            automatically.
          </InfoBox>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Milestone Statuses
          </h3>
          <SimpleTable
            headers={["Status", "Meaning"]}
            rows={[
              [
                "Pending",
                "Freelancer has not yet submitted a deliverable for this milestone.",
              ],
              [
                "In Review",
                "Deliverable submitted, waiting for client review.",
              ],
              ["Approved", "Client approved the deliverable. Payment released."],
              [
                "Auto-Approved",
                "Review timeout expired. Payment released automatically.",
              ],
              [
                "Disputed",
                "A dispute has been raised. Awaiting resolution.",
              ],
              [
                "Resolved",
                "Dispute resolved. Funds distributed per the ruling.",
              ],
            ]}
          />
        </Section>
      </div>

      {/* ─── 8. Disputes ─── */}
      <div id="disputes">
        <Section
          title="Disputes & Resolution"
          icon={<AlertTriangle className="h-5 w-5" />}
        >
          <p>
            Either the client or the freelancer can raise a dispute on any
            active milestone that is in review. The dispute goes through a
            structured multi-phase process:
          </p>
          <FlowDiagram
            steps={[
              "Evidence",
              "Awaiting Judge",
              "Key Distribution",
              "Under Review",
              "Ruled",
              "Executed",
            ]}
          />

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Dispute Phases
          </h3>
          <SimpleTable
            headers={["Phase", "What Happens"]}
            rows={[
              [
                "Evidence",
                "Both parties submit evidence (text, files, screenshots). Each side can submit up to 20 evidence items. An evidence deadline ensures the phase eventually closes.",
              ],
              [
                "Awaiting Judge",
                "The platform admin assigns a judge to the dispute.",
              ],
              [
                "Key Distribution",
                "Both parties share their encrypted job key with the judge so the judge can decrypt and review all evidence.",
              ],
              [
                "Under Review",
                "The judge reviews all evidence and deliverables, then issues a ruling.",
              ],
              [
                "Ruled",
                "The judge has ruled. The ruling can be: Freelancer Wins, Client Wins, or Inconclusive.",
              ],
              [
                "Executed",
                "Anyone can execute the ruling to redistribute funds. After execution, the milestone is marked as Resolved.",
              ],
            ]}
          />

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Possible Rulings
          </h3>
          <SimpleTable
            headers={["Ruling", "Outcome"]}
            rows={[
              [
                "Freelancer Wins",
                "Freelancer receives the milestone payment. Client's behavior bond may be partially forfeited.",
              ],
              [
                "Client Wins",
                "Client receives a refund for the milestone. Freelancer's deposit may be partially forfeited.",
              ],
              [
                "Inconclusive",
                "Milestone payment is split. Both parties receive partial refunds.",
              ],
            ]}
          />

          <InfoBox type="info">
            If the assigned judge fails to issue a ruling before the{" "}
            <strong>ruling deadline</strong>, either party can trigger a{" "}
            <strong>"Claim Ruling Default"</strong> action. This resets the
            judge, and the admin can assign a new one.
          </InfoBox>
        </Section>
      </div>

      {/* ─── 9. Reputation ─── */}
      <div id="reputation">
        <Section
          title="Reputation System"
          icon={<Award className="h-5 w-5" />}
        >
          <p>
            GigSecure uses an on-chain reputation system to track the
            performance of both clients and freelancers. Your reputation
            directly affects your <strong>behavior bond rate</strong> — higher
            tiers mean lower deposits.
          </p>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Reputation Tiers
          </h3>
          <SimpleTable
            headers={["Tier", "Bond Rate", "Requirements"]}
            rows={[
              [
                "🆕 New",
                "7.5%",
                "Default tier for all new users.",
              ],
              [
                "🥉 Bronze",
                "5%",
                "Score ≥ 20, success rate > 50%, completed ≥ 3 jobs.",
              ],
              [
                "🥈 Silver",
                "2.5%",
                "Score ≥ 50, success rate > 75%, completed ≥ 10 jobs.",
              ],
              [
                "🥇 Gold",
                "1%",
                "Score ≥ 80, success rate > 90%, completed ≥ 20 jobs.",
              ],
            ]}
          />

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            How Reputation Changes
          </h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>Completing milestones</strong> increases your score and
              completion count.
            </li>
            <li>
              <strong>Losing disputes</strong> decreases your score and
              increases your dispute loss count.
            </li>
            <li>
              <strong>Abandoning jobs</strong> negatively impacts your
              reputation.
            </li>
          </ul>

          <InfoBox type="tip">
            View your reputation on the <strong>Profile</strong> page. You can
            also view other users' profiles by clicking on their address
            anywhere on the platform.
          </InfoBox>
        </Section>
      </div>

      {/* ─── 10. Judge Panel ─── */}
      <div id="judge">
        <Section
          title="Judge Panel"
          icon={<HammerIcon className="h-5 w-5" />}
        >
          <p>
            Judges are platform-appointed arbitrators who resolve disputes.
            Access to the Judge panel requires the{" "}
            <strong>PLATFORM_JUDGE</strong> role.
          </p>

          <h3 className="font-semibold text-gray-700 mt-3 mb-2">
            Judge Workflow
          </h3>
          <div className="space-y-3">
            <Step number={1} title="Register Encryption Key">
              Before you can be assigned disputes, you must register your
              encryption public key (one-time setup).
            </Step>
            <Step number={2} title="View Assigned Disputes">
              The left panel shows all disputes assigned to you, with their
              current phase, deadlines, and key details.
            </Step>
            <Step number={3} title="Wait for Key Distribution">
              Both parties must share their encrypted job key with you during
              the Key Distribution phase.
            </Step>
            <Step number={4} title="Review Evidence">
              Once you have the keys, decrypt and review all submitted evidence,
              deliverables, and the original job agreement.
            </Step>
            <Step number={5} title="Issue Ruling">
              Submit your ruling (Freelancer Wins, Client Wins, or
              Inconclusive) with a justification.
            </Step>
          </div>
        </Section>
      </div>

      {/* ─── 11. Admin Panel ─── */}
      <div id="admin">
        <Section title="Admin Panel" icon={<Shield className="h-5 w-5" />}>
          <p>
            The Admin page is only accessible to users with the{" "}
            <strong>PLATFORM_ADMIN</strong> or <strong>DEFAULT_ADMIN</strong>{" "}
            role. It provides four tabs:
          </p>

          <SimpleTable
            headers={["Tab", "Features"]}
            rows={[
              [
                "Platform Stats",
                "View overall platform statistics including total jobs, disputes, and revenue.",
              ],
              [
                "Role Management",
                "Grant or revoke PLATFORM_ADMIN, PLATFORM_JUDGE, and other roles to/from addresses.",
              ],
              [
                "Judge Assignment",
                "View pending disputes awaiting judge assignment and assign judges.",
              ],
              [
                "Contract Controls",
                "View treasury balance and use the emergency Pause/Unpause toggle for all contracts.",
              ],
            ]}
          />
        </Section>
      </div>

      {/* ─── 12. Security & Privacy ─── */}
      <div id="security">
        <Section
          title="Security & Privacy"
          icon={<Lock className="h-5 w-5" />}
        >
          <h3 className="font-semibold text-gray-700 mb-2">
            End-to-End Encryption
          </h3>
          <p>
            All sensitive data (job agreements, proposals, deliverables, and
            dispute evidence) is encrypted before being uploaded to IPFS:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 my-2">
            <li>
              A random <strong>AES-256</strong> key is generated for each job.
            </li>
            <li>
              The AES key is wrapped with the recipient's{" "}
              <strong>public key</strong> (registered on-chain).
            </li>
            <li>
              Only the client and selected freelancer can decrypt the content.
            </li>
            <li>
              During disputes, keys are securely shared with the assigned judge.
            </li>
          </ul>

          <h3 className="font-semibold text-gray-700 mt-4 mb-2">
            Smart Contract Security
          </h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              All contracts follow the{" "}
              <strong>checks-effects-interactions</strong> pattern to prevent
              reentrancy.
            </li>
            <li>
              <strong>Pull-over-push</strong> fund distribution — users
              withdraw their own funds rather than having them sent
              automatically.
            </li>
            <li>
              <strong>UUPS upgradeable proxies</strong> — contracts can be
              upgraded without changing addresses.
            </li>
            <li>
              <strong>Pausable</strong> — admin can pause all contracts in an
              emergency.
            </li>
            <li>
              <strong>Role-based access control</strong> — OpenZeppelin
              AccessControl for all privileged operations.
            </li>
          </ul>

          <InfoBox type="warning">
            <strong>Your encryption keys are stored in your browser's local
            storage.</strong>{" "}
            If you clear your browser data or switch browsers, you will lose
            access to encrypted job content. Consider noting down your keys from
            the Wallet page for important jobs.
          </InfoBox>
        </Section>
      </div>

      {/* ─── 13. FAQ ─── */}
      <div id="faq">
        <Section title="Frequently Asked Questions" icon={<BookOpen className="h-5 w-5" />}>
          <div className="space-y-4">
            <div>
              <p className="font-medium text-gray-800">
                Q: What happens if the client never reviews my milestone?
              </p>
              <p className="text-gray-500 mt-1">
                After the review timeout expires, anyone can trigger{" "}
                <strong>auto-approval</strong>. The milestone payment is released
                to you automatically.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: Can I cancel a job after it's started?
              </p>
              <p className="text-gray-500 mt-1">
                Yes, but both parties must agree. Either party can request
                cancellation, and the other must accept. Already-completed
                milestones are still paid out. If the other party doesn't accept,
                you can raise a dispute.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: How much are the platform fees?
              </p>
              <p className="text-gray-500 mt-1">
                A <strong>2% platform fee</strong> is charged on each approved
                milestone. For example, if a milestone is worth 100 USDC, the
                freelancer receives 98 USDC and 2 USDC goes to the platform
                treasury.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: What is a behavior bond?
              </p>
              <p className="text-gray-500 mt-1">
                Both clients and freelancers stake a{" "}
                <strong>behavior bond</strong> (deposit) when creating or
                accepting a job. This incentivizes honest behavior. The bond is
                returned in full when the job completes normally. If you lose a
                dispute or abandon a job, part or all of the bond may be
                forfeited.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: What blockchain does GigSecure run on?
              </p>
              <p className="text-gray-500 mt-1">
                GigSecure is deployed on <strong>Base Sepolia</strong> (an
                Ethereum Layer 2 testnet). For local development, it uses a
                Hardhat local blockchain.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: Is my data private?
              </p>
              <p className="text-gray-500 mt-1">
                Yes. All agreements, proposals, and deliverables are{" "}
                <strong>encrypted end-to-end</strong> before being uploaded to
                IPFS. Only authorized parties (client, freelancer, and judge
                during disputes) can decrypt the content. On-chain data contains
                only hashes and metadata.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: Do I need ETH to use the platform?
              </p>
              <p className="text-gray-500 mt-1">
                Yes, you need a small amount of ETH on Base Sepolia for{" "}
                <strong>gas fees</strong> (transaction costs). All payments are
                made in USDC, but blockchain transactions require ETH for gas.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Q: Can I use this on Firefox or Safari?
              </p>
              <p className="text-gray-500 mt-1">
                Currently, <strong>Google Chrome</strong> is the only supported
                browser because MetaMask injection is required. Firefox's MetaMask
                extension may work but is not officially supported.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ─── External Links ─── */}
      <div className="card text-center space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">
          Additional Resources
        </h2>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="https://github.com/Michael-wzl/ChainLancer"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            GitHub Repository
          </a>
          <a
            href="https://metamask.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            MetaMask
          </a>
          <a
            href="https://app.optimism.io/faucet"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Superchain Faucet
          </a>
        </div>
      </div>
    </div>
  );
}
