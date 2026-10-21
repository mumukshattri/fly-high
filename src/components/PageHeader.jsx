/**
 * components/PageHeader.jsx
 * ---------------------------------------------------------------------------
 * The title / subtitle block at the top of a page, with an optional slot on
 * the right for primary actions (buttons).
 *
 * <PageHeader title="Recruitment Drives" subtitle="...">
 *   <Button icon="filter">Filters</Button>
 * </PageHeader>
 */
export default function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-header__sub">{subtitle}</p> : null}
      </div>
      {children ? <div className="row gap-8 wrap">{children}</div> : null}
    </header>
  );
}
