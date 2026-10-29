export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-7 w-56 rounded-md" />
      <div className="skeleton mb-6 h-4 w-80 rounded-md" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
      <div className="skeleton mt-6 h-72 rounded-xl" />
    </div>
  );
}
