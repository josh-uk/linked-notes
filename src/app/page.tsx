import { BookOpenText, Link2, ShieldCheck } from "lucide-react";

const principles = [
  { icon: BookOpenText, label: "A focused place for your thinking" },
  { icon: Link2, label: "Durable links that survive renames" },
  { icon: ShieldCheck, label: "Private and entirely local" },
];

export default function Home() {
  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="welcome-title">
        <div className="mark" aria-hidden="true">
          LN
        </div>
        <p className="eyebrow">Your knowledge, connected</p>
        <h1 id="welcome-title">Linked Notes</h1>
        <p className="lede">
          A calm local workspace for writing notes and connecting ideas without
          giving up ownership of your data.
        </p>
        <ul className="principles" aria-label="Product principles">
          {principles.map(({ icon: Icon, label }) => (
            <li key={label}>
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
        <p className="foundation-note">The application foundation is ready.</p>
      </section>
    </main>
  );
}
