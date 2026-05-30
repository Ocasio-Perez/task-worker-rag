import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const commands = [
  "/code-status",
  '/code-search acme-api "Where is billing authorization handled?" 5',
  "/code-read acme-api services/billing/auth.ts",
];

const packages = [
  {
    name: "Starter",
    price: "$750-1,500",
    fit: "One technical user or founder",
    items: ["One WSL/Linux machine", "1-3 repos indexed", "Dashboard and slash commands", "Short handoff session"],
  },
  {
    name: "Pro",
    price: "$2,500-5,000",
    fit: "Power user or small technical team",
    items: ["1-2 machines", "5-15 repos", "Reindex automation", "Model/resource tuning"],
  },
  {
    name: "Team",
    price: "$7,500+",
    fit: "Engineering team or large repo",
    items: ["Shared local setup", "Large repo strategy", "Security-focused exclusions", "Team onboarding"],
  },
];

function App() {
  return (
    <main>
      <Hero />
      <section className="band problem">
        <div className="container two-col">
          <div>
            <p className="eyebrow">The Problem</p>
            <h2>AI coding gets awkward when the code is private.</h2>
          </div>
          <p>
            Teams want agents that understand their repositories, but uploading source code to hosted tools can be
            risky, blocked, or simply not aligned with how they work. SourceVault keeps code memory local while giving
            agents a reliable way to inspect repositories.
          </p>
        </div>
      </section>
      <section className="container section">
        <p className="eyebrow">How It Works</p>
        <h2>Local search, exact reads, clear operator control.</h2>
        <div className="flow">
          {["Repos", "ChromaDB", "Task-worker APIs", "Hermes Commands", "Dashboard"].map((item, index) => (
            <React.Fragment key={item}>
              <div className="flow-node">{item}</div>
              {index < 4 ? <div className="flow-line" /> : null}
            </React.Fragment>
          ))}
        </div>
        <div className="feature-grid">
          <Feature title="Local-first" text="Runs on WSL/Linux with local Ollama embeddings and a local ChromaDB store." />
          <Feature title="Command-driven" text="Hermes slash commands avoid fragile model tool-calling loops." />
          <Feature title="Repo-safe" text="Signed APIs, repo confinement, ignored secret files, and path escape checks." />
          <Feature title="Installable" text="Systemd templates, prebuilt workflows, status checks, and dashboard visibility." />
        </div>
      </section>
      <section className="band dark">
        <div className="container two-col">
          <div>
            <p className="eyebrow">Operator Experience</p>
            <h2>Ask local agents about code without handing them the whole repo.</h2>
          </div>
          <div className="terminal">
            {commands.map((command) => (
              <div className="terminal-line" key={command}>
                <span>$</span>
                <code>{command}</code>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="container section" id="packages">
        <p className="eyebrow">Packages</p>
        <h2>Start as a done-for-you private setup.</h2>
        <div className="pricing">
          {packages.map((tier) => (
            <article className="price-card" key={tier.name}>
              <h3>{tier.name}</h3>
              <p className="price">{tier.price}</p>
              <p className="fit">{tier.fit}</p>
              <ul>
                {tier.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="container trust">
        <div>
          <p className="eyebrow">Golden Path</p>
          <h2>Built first for WSL2 Ubuntu and Linux.</h2>
          <p>
            SourceVault starts where local AI builders already are: WSL/Linux, Node, Ollama, ChromaDB, and local repo
            mirrors. macOS support can follow as an assisted install path.
          </p>
        </div>
        <div className="specs">
          <Spec label="Minimum" value="8 cores, 24GB RAM, 100GB SSD" />
          <Spec label="Recommended" value="12+ cores, 32-64GB RAM, 250GB NVMe" />
          <Spec label="Default embedding" value="nomic-embed-text" />
          <Spec label="Default reasoning" value="qwen3-coder:30b" />
        </div>
      </section>
      <section className="cta">
        <div className="container cta-inner">
          <h2>Give local AI agents private code memory.</h2>
          <p>SourceVault is preparing pilot installs for privacy-conscious builders and small engineering teams.</p>
          <a href="mailto:hello@trysourcevault.com?subject=SourceVault%20pilot%20install" className="button">
            Request a Pilot Install
          </a>
        </div>
      </section>
    </main>
  );
}

function Hero() {
  return (
    <section className="hero">
      <CodeGraph />
      <nav className="nav">
        <div className="mark">SourceVault</div>
        <a href="mailto:hello@trysourcevault.com?subject=SourceVault%20pilot%20install" className="nav-link">
          Request Pilot
        </a>
      </nav>
      <div className="hero-content">
        <p className="eyebrow">Private Code Memory for Local AI Agents</p>
        <h1>SourceVault</h1>
        <p className="lede">
          Let AI agents understand and inspect your codebase without sending source code to the cloud.
        </p>
        <div className="hero-actions">
          <a href="mailto:hello@trysourcevault.com?subject=SourceVault%20pilot%20install" className="button">
            Request a Pilot Install
          </a>
          <a href="#packages" className="button secondary">
            View Packages
          </a>
        </div>
      </div>
    </section>
  );
}

function CodeGraph() {
  const nodes = [
    ["repo", 16, 32],
    ["index", 36, 16],
    ["chroma", 58, 30],
    ["agent", 79, 16],
    ["dashboard", 84, 52],
    ["auth", 38, 60],
    ["slash", 64, 70],
    ["local", 16, 76],
  ];

  return (
    <div className="graph" aria-hidden="true">
      <svg viewBox="0 0 100 80" preserveAspectRatio="none">
        <path d="M16 32 L36 16 L58 30 L79 16 L84 52 L64 70 L38 60 L16 76 L16 32" />
        <path d="M36 16 L38 60 L64 70 L58 30" />
        <path d="M16 76 L58 30 L84 52" />
      </svg>
      {nodes.map(([label, x, y], index) => (
        <div
          className="graph-node"
          style={{ left: `${x}%`, top: `${y}%`, "--delay": `${index * 0.22}s` }}
          key={label}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function Feature({ title, text }) {
  return (
    <article className="feature">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function Spec({ label, value }) {
  return (
    <div className="spec">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
