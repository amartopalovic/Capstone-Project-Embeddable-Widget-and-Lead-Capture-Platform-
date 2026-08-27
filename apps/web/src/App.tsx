/**
 * Stage 1 placeholder shell.
 *
 * This exists only to prove the React build and dev server work. The real
 * landing page, authentication entry points, dashboard, widget builder, and
 * contact inbox arrive from Stage 3 onward.
 */
export function App(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Embeddable Widget &amp; Lead-Capture Platform</h1>
      <p className="mt-4">
        Stage 1 skeleton. This application boots and builds; it has no features yet.
      </p>
      <p className="mt-2 text-sm">
        The separate-origin demo sandbox runs independently on port 5174.
      </p>
    </main>
  );
}
