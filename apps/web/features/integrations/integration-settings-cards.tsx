export interface IntegrationMetricCardItem {
  label: string;
  value: number | string;
}

export function IntegrationMetricGrid({
  items,
}: {
  items: IntegrationMetricCardItem[];
}) {
  return (
    <div className="feishu-mini-panel-grid">
      {items.map((item) => (
        <section className="feishu-mini-panel" key={item.label}>
          <strong>{item.label}</strong>
          <span>{item.value}</span>
        </section>
      ))}
    </div>
  );
}
