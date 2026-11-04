import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import type { User } from 'oidc-client-ts';
import { apiRequest, apiStream, formatDate, formatMoney, jsonBody, withQuery } from './api.js';
import { AuthProvider, useAuth } from './auth.js';
import './styles.css';

type Role = 'owner' | 'admin' | 'finops' | 'security' | 'developer' | 'viewer';
type Membership = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: Role;
};
type MeResponse = { user: { id: string; email: string; fullName: string }; memberships: Membership[] };
type Resource<T> = { items: T[] };
type PaginatedResource<T> = { items: T[]; total: number; limit: number; offset: number };
type OrgResource<T> = { items: T[] };
type Action = (event: FormEvent<HTMLFormElement>) => Promise<void>;

const navigation = [
  { path: '/overview', label: 'Visão geral', permission: 'costs:read' },
  { path: '/usage', label: 'Consumo de APIs', permission: 'costs:read' },
  { path: '/costs', label: 'Custos', permission: 'costs:read' },
  { path: '/licenses', label: 'Licenças e assentos', permission: 'connectors:read' },
  { path: '/projects', label: 'Projetos e equipes', permission: 'projects:read' },
  { path: '/virtual-keys', label: 'Chaves virtuais', permission: 'virtual_keys:read' },
  { path: '/test-chat', label: 'Chat de teste', permission: 'virtual_keys:test' },
  { path: '/guardrails', label: 'Guardrails', permission: 'guardrails:read' },
  { path: '/budgets', label: 'Orçamentos', permission: 'budgets:read' },
  { path: '/connectors', label: 'Conectores', permission: 'connectors:read' },
  { path: '/audit', label: 'Auditoria', permission: 'audit:read' },
] as const;

const rolePermissions: Record<Role, string[]> = {
  owner: ['org:manage', 'org:read', 'members:manage', 'projects:manage', 'projects:read', 'teams:manage', 'teams:read', 'virtual_keys:manage', 'virtual_keys:read', 'virtual_keys:test', 'guardrails:manage', 'guardrails:read', 'budgets:manage', 'budgets:read', 'prices:manage', 'costs:read', 'costs:manage', 'connectors:manage', 'connectors:read', 'audit:read', 'prompts:read', 'prompts:manage'],
  admin: ['org:read', 'members:manage', 'projects:manage', 'projects:read', 'teams:manage', 'teams:read', 'virtual_keys:manage', 'virtual_keys:read', 'virtual_keys:test', 'guardrails:manage', 'guardrails:read', 'budgets:manage', 'budgets:read', 'prices:manage', 'costs:read', 'costs:manage', 'connectors:manage', 'connectors:read', 'audit:read', 'prompts:read', 'prompts:manage'],
  finops: ['org:read', 'projects:read', 'teams:read', 'budgets:manage', 'budgets:read', 'prices:manage', 'costs:read', 'costs:manage', 'connectors:manage', 'connectors:read'],
  security: ['org:read', 'projects:read', 'teams:read', 'virtual_keys:read', 'audit:read', 'prompts:read'],
  developer: ['org:read', 'projects:read', 'teams:read', 'virtual_keys:manage', 'virtual_keys:read', 'budgets:read'],
  viewer: ['org:read', 'projects:read', 'teams:read', 'budgets:read', 'costs:read', 'connectors:read'],
};

function hasPermission(role: Role, permission: string): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

function useResource<T>(path: string | null, token: string | undefined) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    if (!path || !token) {
      setLoading(false);
      setData(null);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    apiRequest<T>(path, token)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar os dados');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [path, revision, token]);

  return { data, loading, error, reload };
}

function LoginPage() {
  const { login, loginLocal, config, error } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitLocal: Action = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setLoginError(null);
    try {
      await loginLocal(String(form.get('email')), String(form.get('password')));
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : 'Não foi possível entrar');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">IA</div>
        <p className="eyebrow">AI SPEND &amp; GOVERNANCE</p>
        <h1>Governança de IA, com clareza.</h1>
        <p>Entre para acompanhar consumo, custos, orçamentos e integrações da sua organização.</p>
        {(loginError || error) && <Notice tone="error">{loginError ?? error}</Notice>}
        {config?.localEnabled && <form className="form-card" onSubmit={(event) => void submitLocal(event)}>
          <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="button primary wide" disabled={busy}>Entrar</button>
        </form>}
        {config?.oidcEnabled && <button className={`button wide${config.localEnabled ? '' : ' primary'}`} onClick={() => void login().catch((cause: unknown) => setLoginError(cause instanceof Error ? cause.message : 'Não foi possível iniciar o login'))}>
          Entrar com SSO
        </button>}
        <small>{config?.oidcEnabled ? 'SSO via Keycloak (OIDC) disponível.' : 'Autenticação local por e-mail e senha.'}</small>
      </section>
    </main>
  );
}

function PasswordChangeForm({ forced }: { forced: boolean }) {
  const { changePassword, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get('newPassword') !== form.get('confirm')) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(String(form.get('currentPassword')), String(form.get('newPassword')));
      formElement.reset();
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha');
    } finally {
      setBusy(false);
    }
  };
  return <section className="login-card">
    <p className="eyebrow">CONTA</p>
    <h1>{forced ? 'Defina uma nova senha' : 'Alterar senha'}</h1>
    {forced && <p>Sua senha foi definida por um administrador. Troque-a para continuar.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    {done && <Notice tone="success">Senha alterada. Outras sessões foram encerradas.</Notice>}
    <form className="form-card" onSubmit={(event) => void submit(event)}>
      <label>Senha atual<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>Nova senha<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>Mínimo de 12 caracteres.</small></label>
      <label>Confirmar nova senha<input name="confirm" type="password" autoComplete="new-password" required /></label>
      <button className="button primary" disabled={busy}>Alterar senha</button>
    </form>
    {forced && <button className="button" onClick={() => void logout()}>Sair</button>}
  </section>;
}

function LoginCallback() {
  const { completeLogin, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (loading) return undefined;
    let active = true;
    completeLogin()
      .then(() => { if (active) navigate('/overview', { replace: true }); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao concluir autenticação');
      });
    return () => { active = false; };
  }, [completeLogin, loading, navigate]);
  return <main className="login-screen"><section className="login-card"><p className="eyebrow">AUTENTICAÇÃO</p><h1>{error ? 'Não foi possível entrar' : 'Validando seu acesso…'}</h1>{error && <><Notice tone="error">{error}</Notice><Link to="/">Voltar ao login</Link></>}</section></main>;
}

function OrganizationSetup({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit: Action = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/v1/organizations', token, jsonBody({
        name: String(form.get('name')),
        slug: slugify(String(form.get('name'))),
      }));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a organização');
    } finally {
      setBusy(false);
    }
  };
  return <section className="empty-state"><h2>Crie sua primeira organização</h2><p>Seu usuário ainda não está associado a uma organização.</p><form className="inline-form" onSubmit={(event) => void submit(event)}><label>Nome da organização<input name="name" required /></label><button className="button primary" disabled={busy}>Criar organização</button></form>{error && <Notice tone="error">{error}</Notice>}</section>;
}

function DashboardLayout() {
  const { user, loading: authLoading, logout, mustChangePassword, config } = useAuth();
  const token = user?.access_token;
  const [search, setSearch] = useSearchParams();
  const mePath = token && !mustChangePassword ? '/v1/me' : null;
  const { data: me, loading, error, reload } = useResource<MeResponse>(mePath, token);
  const memberships = me?.memberships ?? [];
  const orgId = search.get('organizationId') ?? memberships[0]?.organization_id ?? '';
  const membership = memberships.find((item) => item.organization_id === orgId);
  const role = membership?.role;
  const location = useLocation();

  useEffect(() => {
    if (memberships.length) {
      const next = new URLSearchParams(search);
      let changed = false;
      if (!membership || search.get('organizationId') !== orgId) {
        next.set('organizationId', membership ? orgId : memberships[0]!.organization_id);
        next.delete('projectId');
        next.delete('teamId');
        changed = true;
      }
      const today = new Date();
      const endDate = today.toISOString().slice(0, 10);
      const startDate = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
      if (!next.has('startDate')) {
        next.set('startDate', startDate);
        changed = true;
      }
      if (!next.has('endDate')) {
        next.set('endDate', endDate);
        changed = true;
      }
      if (changed) setSearch(next, { replace: true });
    }
  }, [membership, memberships, orgId, search, setSearch]);

  if (authLoading) return <main className="centered"><Spinner label="Carregando sessão" /></main>;
  if (!user) return <LoginPage />;
  if (mustChangePassword) return <main className="login-screen"><PasswordChangeForm forced /></main>;
  if (loading) return <main className="centered"><Spinner label="Carregando organizações" /></main>;
  if (error) return <main className="centered"><Notice tone="error">{error}</Notice><button className="button" onClick={reload}>Tentar novamente</button></main>;
  if (!memberships.length) return <main className="centered"><OrganizationSetup token={token!} onCreated={reload} /></main>;

  const currentRole = membership?.role;
  if (!membership || !currentRole) return <main className="centered"><Notice tone="error">Você não possui acesso à organização selecionada.</Notice></main>;
  const visibleNav = navigation.filter((item) => hasPermission(currentRole, item.permission));
  const activePage = navigation.find((item) => item.path === location.pathname);
  const canOpenPage = !activePage || hasPermission(currentRole, activePage.permission);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/overview"><span className="brand-mark small">IA</span><span><strong>IA Governance</strong><small>AI spend platform</small></span></Link>
        <div className="org-picker">
          <label htmlFor="active-org">Organização ativa</label>
          <select id="active-org" value={orgId} onChange={(event) => {
            const next = new URLSearchParams(search);
            next.set('organizationId', event.target.value);
            next.delete('projectId');
            next.delete('teamId');
            setSearch(next);
          }}>
            {memberships.map((item) => <option key={item.organization_id} value={item.organization_id}>{item.organization_name}</option>)}
          </select>
          <span className="role-tag">{currentRole}</span>
        </div>
        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-caption">WORKSPACE</span>
          {visibleNav.map((item) => <Link key={item.path} className={location.pathname === item.path ? 'active' : ''} to={{ pathname: item.path, search: search.toString() }}>{item.label}</Link>)}
          {config?.localEnabled && <Link className={location.pathname === '/account/password' ? 'active' : ''} to={{ pathname: '/account/password', search: search.toString() }}>Alterar senha</Link>}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{(me?.user.fullName ?? user.profile.name ?? 'U').slice(0, 1).toUpperCase()}</span>
          <span className="user-copy"><strong>{me?.user.fullName ?? user.profile.name ?? 'Usuário'}</strong><small>{me?.user.email ?? user.profile.email}</small></span>
          <button className="icon-button" title="Sair" aria-label="Sair" onClick={() => void logout()}>↗</button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><p className="eyebrow">WORKSPACE / {membership.organization_name}</p><h1>{navigation.find((item) => item.path === location.pathname)?.label ?? 'Dashboard'}</h1></div><div className="topbar-status"><span className="status-dot" /> Ambiente protegido</div></header>
        <FiltersBar token={token!} orgId={orgId} />
        <div className="page-content">{canOpenPage ? <Outlet context={{ token: token!, orgId, role: currentRole, membership }} /> : <Notice tone="error">Seu perfil não tem permissão para acessar esta página.</Notice>}</div>
      </main>
    </div>
  );
}

type DashboardContext = { token: string; orgId: string; role: Role; membership: Membership };
function useDashboard() {
  return useOutletContext<DashboardContext>();
}

function useFiltersPath(base: string, extras?: Record<string, string | undefined>) {
  const [search] = useSearchParams();
  return useMemo(() => withQuery(base, search, extras), [base, extras, search]);
}

function FiltersBar({ token, orgId }: { token: string; orgId: string }) {
  const [search, setSearch] = useSearchParams();
  const [provider, setProvider] = useState(search.get('provider') ?? '');
  const [model, setModel] = useState(search.get('model') ?? '');
  const projects = useResource<Resource<{ id: string; name: string }>>(
    `/v1/organizations/${orgId}/projects`, token,
  ).data?.items ?? [];
  const teams = useResource<Resource<{ id: string; name: string }>>(
    `/v1/organizations/${orgId}/teams`, token,
  ).data?.items ?? [];
  const costDimensions = useResource<{ users: Array<{ id: string; full_name: string }> }>(
    `/v1/organizations/${orgId}/costs/dimensions`, token,
  ).data?.users ?? [];
  useEffect(() => {
    setProvider(search.get('provider') ?? '');
    setModel(search.get('model') ?? '');
  }, [search]);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('organizationId', orgId);
    setSearch(next, { replace: true });
  };
  return (
    <section className="filter-bar" aria-label="Filtros globais">
      <label>Início<input type="date" value={search.get('startDate') ?? ''} onChange={(event) => setFilter('startDate', event.target.value)} /></label>
      <label>Fim<input type="date" value={search.get('endDate') ?? ''} onChange={(event) => setFilter('endDate', event.target.value)} /></label>
      <label>Projeto<select value={search.get('projectId') ?? ''} onChange={(event) => setFilter('projectId', event.target.value)}><option value="">Todos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Equipe<select value={search.get('teamId') ?? ''} onChange={(event) => setFilter('teamId', event.target.value)}><option value="">Todas</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Pessoa<select value={search.get('userId') ?? ''} onChange={(event) => setFilter('userId', event.target.value)}><option value="">Todas</option>{costDimensions.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
      <label>Provedor<input value={provider} placeholder="Todos" onChange={(event) => setProvider(event.target.value)} onBlur={() => setFilter('provider', provider)} /></label>
      <label>Modelo<input value={model} placeholder="Todos" onChange={(event) => setModel(event.target.value)} onBlur={() => setFilter('model', model)} /></label>
      <label>Categoria<select value={search.get('costCategory') ?? ''} onChange={(event) => setFilter('costCategory', event.target.value)}><option value="">Todas</option><option value="gateway_estimated">Estimado pelo gateway</option><option value="guardrail_evaluation">Avaliação de guardrail (LLM)</option><option value="simulated">Simulado</option><option value="provider_reported">Reportado</option><option value="license_contracted">Licença contratada</option><option value="financial_adjustment">Ajuste financeiro</option><option value="unreconciled">Não reconciliado</option></select></label>
      <label>Origem<select value={search.get('dataSource') ?? ''} onChange={(event) => setFilter('dataSource', event.target.value)}><option value="">Todas</option><option value="gateway_local">Gateway local</option><option value="csv">CSV</option><option value="official_api">API oficial</option></select></label>
      <button className="clear-filters" onClick={() => setSearch({ organizationId: orgId })}>Limpar</button>
    </section>
  );
}

function OverviewPage() {
  const { token, orgId } = useDashboard();
  const path = useFiltersPath(`/v1/organizations/${orgId}/dashboard/overview`);
  const { data, loading, error, reload } = useResource<OverviewData>(path, token);
  if (loading) return <Spinner label="Carregando indicadores" />;
  if (error) return <PageError message={error} retry={reload} />;
  if (!data) return <EmptyState>Dados não disponíveis.</EmptyState>;

  const total = (category: string) => data.costsByCategory.filter((row) => row.cost_category === category);
  const dates = `${formatDate(data.period.startDate)} — ${formatDate(data.period.endDate)}`;
  const cards = [
    { title: 'Custo estimado', category: 'gateway_estimated', label: 'Estimado pelo gateway' },
    { title: 'Custo de guardrails', category: 'guardrail_evaluation', label: 'Avaliações por LLM' },
    { title: 'Custo reportado', category: 'provider_reported', label: 'Reportado pelo fornecedor' },
    { title: 'Custo de licenças', category: 'license_contracted', label: 'Contratado' },
    { title: 'Ajustes financeiros', category: 'financial_adjustment', label: 'Ajuste' },
  ];
  return (
    <div className="page-stack">
      <div className="period-banner"><span>PERÍODO DE REFERÊNCIA</span><strong>{dates}</strong><small>{data.currencyNote}</small></div>
      <section className="kpi-grid">
        {cards.map((card) => <article className="kpi-card" key={card.category}><span className="kpi-title">{card.title}</span><strong>{total(card.category).length ? total(card.category).map((row) => `${formatMoney(row.amount, row.currency)} (${row.is_simulated ? 'Simulado' : card.label})`).join(' · ') : 'Dados não disponíveis'}</strong><small>{card.label} · moeda original</small></article>)}
        <article className="kpi-card"><span className="kpi-title">Reconciliação pendente</span><strong>{data.pendingReconciliation.length ? data.pendingReconciliation.map((row) => `${row.record_count} registro(s) · ${formatMoney(row.amount, row.currency)}`).join(' / ') : 'Dados não disponíveis'}</strong><small>Custos reportados sem correspondência concluída</small></article>
        <article className="kpi-card"><span className="kpi-title">Orçamentos em alerta/bloqueio</span><strong>{data.budgets.filter((item) => item.mode === 'block' || Number(item.utilization_percent) >= 80).length}</strong><small>{data.budgets.length ? 'Políticas dentro do escopo atual' : 'Dados não disponíveis'}</small></article>
      </section>

      <div className="section-heading"><div><p className="eyebrow">USO DE IA</p><h2>Consumo por provedor e modelo</h2></div></div>
      <DataTable rows={data.consumptionByProviderModel} empty="Nenhum consumo registrado no período." columns={[
        { title: 'Provedor', render: (row) => row.provider },
        { title: 'Modelo', render: (row) => row.model },
        { title: 'Chamadas', render: (row) => row.request_count },
        { title: 'Tokens de entrada', render: (row) => nullableNumber(row.input_tokens) },
        { title: 'Tokens de saída', render: (row) => nullableNumber(row.output_tokens) },
        { title: 'Latência total (ms)', render: (row) => nullableNumber(row.duration_ms) },
      ]} />
      <div className="two-column">
        <section><div className="section-heading compact"><div><p className="eyebrow">ALOCATION</p><h2>Consumo por projeto</h2></div></div><DataTable rows={data.consumptionByProject} empty="Sem consumo por projeto." columns={[
          { title: 'Projeto', render: (row) => row.project_name },
          { title: 'Chamadas', render: (row) => row.request_count },
          { title: 'Tokens', render: (row) => nullableSum(row.input_tokens, row.output_tokens) },
        ]} /></section>
        <section><div className="section-heading compact"><div><p className="eyebrow">ALLOCATION</p><h2>Consumo por equipe</h2></div></div><DataTable rows={data.consumptionByTeam} empty="Sem consumo associado a equipes." columns={[
          { title: 'Equipe', render: (row) => row.team_name },
          { title: 'Chamadas', render: (row) => row.request_count },
          { title: 'Tokens', render: (row) => nullableSum(row.input_tokens, row.output_tokens) },
        ]} /></section>
      </div>
      <div className="two-column">
        <section><div className="section-heading compact"><div><p className="eyebrow">CONTROLE</p><h2>Utilização de orçamentos</h2></div></div><DataTable rows={data.budgets} empty="Nenhuma política ativa no período." columns={[
          { title: 'Política', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.scope_type}</small></> },
          { title: 'Uso / limite', render: (row) => `${formatMoney(row.spent_amount, row.currency)} / ${formatMoney(row.limit_amount, row.currency)}` },
          { title: 'Utilização', render: (row) => <Progress value={row.utilization_percent == null ? null : Number(row.utilization_percent)} mode={row.mode} /> },
        ]} /></section>
        <section><div className="section-heading compact"><div><p className="eyebrow">LICENÇAS</p><h2>Assentos e atividade</h2></div></div><DataTable rows={data.licenses} empty="Dados de licenças não disponíveis." columns={[
          { title: 'Produto', render: (row) => <>{row.product_name}<small className="cell-subtitle">{row.provider}</small></> },
          { title: 'Atribuídos', render: (row) => `${row.assigned_seats} / ${row.contracted_seats}` },
          { title: 'Sem atividade', render: (row) => row.idle_seats },
          { title: 'Atividade desconhecida', render: (row) => row.unknown_activity_seats },
        ]} /></section>
      </div>
      <div className="two-column">
        <section><div className="section-heading compact"><div><p className="eyebrow">INTEGRAÇÕES</p><h2>Saúde das fontes</h2></div></div><DataTable rows={data.sources} empty="Nenhuma fonte configurada." columns={[
          { title: 'Fonte', render: (row) => <>{row.name}<small className="cell-subtitle">{row.provider} · {row.connection_type}</small></> },
          { title: 'Última execução', render: (row) => formatDate(row.last_synced_at ?? row.last_run_at) },
          { title: 'Estado', render: (row) => <Badge tone={row.is_stale ? 'warning' : 'success'}>{row.is_stale ? 'Desatualizada' : row.last_run_status ?? 'Saudável'}</Badge> },
        ]} /></section>
        <section><div className="section-heading compact"><div><p className="eyebrow">RECONCILIAÇÃO</p><h2>Itens pendentes</h2></div></div><DataTable rows={data.pendingReconciliation} empty="Nenhum custo pendente neste período." columns={[
          { title: 'Moeda', render: (row) => row.currency },
          { title: 'Registros', render: (row) => row.record_count },
          { title: 'Valor', render: (row) => formatMoney(row.amount, row.currency) },
        ]} /></section>
      </div>
    </div>
  );
}

function UsagePage() {
  const { token, orgId, role } = useDashboard();
  const path = useFiltersPath(`/v1/organizations/${orgId}/usage-events`, { limit: '200' });
  const { data, loading, error, reload } = useResource<Resource<UsageRow>>(path, token);
  const canReadPrompts = hasPermission(role, 'prompts:read');
  const canManagePrompts = hasPermission(role, 'prompts:manage');
  const privacy = useResource<PrivacySettings>(
    canReadPrompts ? `/v1/organizations/${orgId}/privacy-settings` : null,
    token,
  );
  const [selectedEvent, setSelectedEvent] = useState<UsageRow | null>(null);
  const [content, setContent] = useState<StoredContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState('7');
  const [captureEnabled, setCaptureEnabled] = useState(false);
  useEffect(() => {
    if (privacy.data) {
      setRetentionDays(String(privacy.data.prompt_capture_retention_days));
      setCaptureEnabled(privacy.data.prompt_capture_enabled);
    }
  }, [privacy.data]);
  const openContent = async (row: UsageRow) => {
    setSelectedEvent(row);
    setContent(null);
    setContentError(null);
    setContentLoading(true);
    try {
      setContent(await apiRequest<StoredContent>(
        `/v1/organizations/${orgId}/usage-events/${row.id}/content`,
        token,
      ));
    } catch (cause) {
      setContentError(cause instanceof Error ? cause.message : 'Falha ao carregar o conteúdo');
    } finally {
      setContentLoading(false);
    }
  };
  const savePrivacy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPrivacyError(null);
    setPrivacyMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/privacy-settings`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          promptCaptureEnabled: form.get('promptCaptureEnabled') === 'on',
          promptCaptureRetentionDays: Number(retentionDays),
        }),
      });
      setPrivacyMessage('Configurações de captura atualizadas.');
      privacy.reload();
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : 'Falha ao salvar configurações');
    }
  };
  return <PageFrame title="Histórico de inferências" subtitle="Eventos, tokens e latência registrados no ledger">
    {canManagePrompts && <section className="form-card">
      <h3>Privacidade e captura de conteúdo</h3>
      <p className="muted">Quando habilitada, prompts e respostas só serão armazenados se a chamada também enviar <code>store: true</code>. Conteúdo cifrado será removido ao fim do prazo configurado.</p>
      {privacyMessage && <Notice tone="success">{privacyMessage}</Notice>}
      {privacyError && <Notice tone="error">{privacyError}</Notice>}
      <form className="form-grid" onSubmit={(event) => void savePrivacy(event)}>
        <label className="checkbox-field"><input name="promptCaptureEnabled" type="checkbox" checked={captureEnabled} onChange={(event) => setCaptureEnabled(event.target.checked)} /> Permitir captura de prompts e respostas nesta organização</label>
        <label>Retenção do conteúdo (dias; 1–365)<input type="number" min="1" max="365" required value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} /></label>
        <button className="button primary" disabled={privacy.loading}>Salvar privacidade</button>
      </form>
    </section>}
    {loading ? <Spinner label="Carregando consumo" /> : error ? <PageError message={error} retry={reload} /> : <DataTable rows={data?.items ?? []} empty="Nenhum evento corresponde aos filtros atuais." columns={[
      { title: 'Data', render: (row) => formatDate(row.createdAt) },
      { title: 'Provedor / modelo', render: (row) => <>{row.provider}<small className="cell-subtitle">{row.model}</small></> },
      { title: 'Origem', render: (row) => row.source === 'dashboard_test' ? <>Chat de teste<small className="cell-subtitle">Operador: {row.testActorName ?? row.testActorUserId}</small></> : row.clientOrigin ? <>Gateway<small className="cell-subtitle">Cliente: {row.clientOrigin}</small></> : 'Gateway' },
      { title: 'Projeto', render: (row) => row.projectName ?? row.projectId },
      { title: 'Equipe / pessoa', render: (row) => <>{row.teamName ?? 'Sem equipe'}<small className="cell-subtitle">{row.userName ?? 'Não atribuído'}</small></> },
      { title: 'Tokens entrada / saída', render: (row) => `${nullableNumber(row.inputTokens)} / ${nullableNumber(row.outputTokens)}` },
      { title: 'Latência', render: (row) => row.durationMs == null ? 'Dados não disponíveis' : `${row.durationMs} ms` },
      { title: 'Estado', render: (row) => <Badge tone={row.status === 'succeeded' ? 'success' : row.status === 'uncertain' ? 'warning' : 'neutral'}>{row.status}</Badge> },
      { title: 'Conteúdo', render: (row) => row.contentCaptured && canReadPrompts
        ? <button className="button small" onClick={() => void openContent(row)}>Ver prompt e resposta</button>
        : <span className="muted">Não armazenado</span> },
    ]} />}
    {selectedEvent && <section className="form-card">
      <div className="section-heading compact"><div><p className="eyebrow">EVENTO {selectedEvent.id}</p><h2>Prompt e resposta</h2></div><button className="button small" onClick={() => { setSelectedEvent(null); setContent(null); }}>Fechar</button></div>
      {contentLoading && <Spinner label="Descriptografando conteúdo" />}
      {contentError && <Notice tone="error">{contentError}</Notice>}
      {content && <><h3>Mensagens de entrada</h3>{content.messages.map((message, index) => <article className="content-message" key={`${message.role}-${index}`}><strong>{message.role}</strong><pre>{message.content}</pre></article>)}<h3>Resposta</h3><pre className="content-message">{content.response}</pre></>}
    </section>}
  </PageFrame>;
}

function CostsPage() {
  const { token, orgId } = useDashboard();
  const [search] = useSearchParams();
  const [modelCostPage, setModelCostPage] = useState(0);
  const summaryPath = useFiltersPath(`/v1/organizations/${orgId}/costs/summary`);
  const modelCostsPath = useFiltersPath(`/v1/organizations/${orgId}/costs/by-model`, {
    limit: '100',
    offset: String(modelCostPage * 100),
  });
  const reconciliationPath = useFiltersPath(`/v1/organizations/${orgId}/reconciliation-matches`);
  const summary = useResource<Resource<CostRow>>(summaryPath, token);
  const modelCosts = useResource<PaginatedResource<CostModelRow>>(modelCostsPath, token);
  const reconciliation = useResource<Resource<Record<string, unknown>>>(reconciliationPath, token);
  useEffect(() => setModelCostPage(0), [search]);
  return <PageFrame title="Custos e reconciliação" subtitle="Categorias financeiras mantidas separadas; moedas não são agregadas entre si">
    {summary.loading || modelCosts.loading || reconciliation.loading ? <Spinner label="Carregando custos" /> : summary.error || modelCosts.error || reconciliation.error ? <Notice tone="error">{summary.error ?? modelCosts.error ?? reconciliation.error}</Notice> : <>
      <DataTable rows={summary.data?.items ?? []} empty="Dados financeiros não disponíveis para os filtros atuais." columns={[
        { title: 'Categoria', render: (row) => <Badge>{costCategoryLabel(row.costCategory)}</Badge> },
        { title: 'Origem / simulação', render: (row) => row.isSimulated ? 'Simulado' : 'Fonte real/contratada' },
        { title: 'Moeda', render: (row) => row.currency },
        { title: 'Valor', render: (row) => formatMoney(row.amount, row.currency) },
        { title: 'Registros', render: (row) => row.recordCount },
      ]} />
      <div className="section-heading"><div><p className="eyebrow">ANÁLISE DE INFERÊNCIA</p><h2>Custos por provedor e modelo</h2><p className="muted">Os valores permanecem separados por moeda, categoria e origem. “Não atribuído” significa que a chave não tem proprietário.</p></div></div>
      <DataTable rows={modelCosts.data?.items ?? []} empty="Nenhum custo de inferência corresponde aos filtros atuais." columns={[
        { title: 'Provedor / modelo', render: (row) => <>{row.provider}<small className="cell-subtitle">{row.model ?? 'Modelo não informado'}</small></> },
        { title: 'Projeto / equipe', render: (row) => <>{row.project_name ?? 'Sem projeto'}<small className="cell-subtitle">{row.team_name ?? 'Sem equipe'}</small></> },
        { title: 'Pessoa', render: (row) => row.user_name ?? 'Não atribuído' },
        { title: 'Categoria / origem', render: (row) => <><Badge>{costCategoryLabel(row.cost_category)}</Badge><small className="cell-subtitle">{row.is_simulated ? 'Estimado/simulado' : 'Reportado'}</small></> },
        { title: 'Moeda', render: (row) => row.currency },
        { title: 'Valor', render: (row) => formatMoney(row.amount, row.currency) },
        { title: 'Registros', render: (row) => row.record_count },
      ]} />
      {modelCosts.data && modelCosts.data.total > 100 && <div className="pagination">
        <button className="button small" onClick={() => setModelCostPage((page) => Math.max(0, page - 1))} disabled={modelCostPage === 0}>Anterior</button>
        <span>{modelCostPage * 100 + 1}–{Math.min((modelCostPage + 1) * 100, modelCosts.data.total)} de {modelCosts.data.total}</span>
        <button className="button small" onClick={() => setModelCostPage((page) => page + 1)} disabled={(modelCostPage + 1) * 100 >= modelCosts.data.total}>Próxima</button>
      </div>}
      <div className="section-heading"><div><p className="eyebrow">TRILHA FINANCEIRA</p><h2>Reconciliações</h2></div></div>
      <DataTable rows={reconciliation.data?.items ?? []} empty="Nenhuma reconciliação registrada." columns={[
        { title: 'Data', render: (row) => formatDate(String(row.reconciled_at ?? '')) },
        { title: 'Status', render: (row) => <Badge tone={row.status === 'matched' ? 'success' : row.status === 'unreconciled' ? 'warning' : 'neutral'}>{String(row.status)}</Badge> },
        { title: 'Moeda', render: (row) => String(row.currency) },
        { title: 'Variação', render: (row) => formatMoney(String(row.delta_amount), String(row.currency)) },
        { title: 'Notas', render: (row) => String(row.notes ?? '—') },
      ]} />
    </>}
  </PageFrame>;
}

function LicensesPage() {
  const { token, orgId, role } = useDashboard();
  const path = useFiltersPath(`/v1/organizations/${orgId}/licenses`);
  const { data, loading, error, reload } = useResource<LicenseData>(path, token);
  const membersPath = hasPermission(role, 'members:manage') ? `/v1/organizations/${orgId}/memberships` : null;
  const { data: members } = useResource<Resource<MemberRow>>(membersPath, token);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({});
  const matchIdentity = async (identityId: string) => {
    setMessage(null);
    setActionError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/external-identities/${identityId}/match`, token, jsonBody({ userId: selectedUsers[identityId] }));
      setMessage('Identidade associada e registrada na auditoria.');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Falha ao associar identidade');
    }
  };
  return <PageFrame title="Contratos e assentos" subtitle="Atribuições sem preço permanecem sem custo inventado; atividade ausente não é tratada como inatividade">
    {message && <Notice tone="success">{message}</Notice>}{actionError && <Notice tone="error">{actionError}</Notice>}
    {loading ? <Spinner label="Carregando licenças" /> : error ? <PageError message={error} retry={reload} /> : <>
      <DataTable rows={data?.contracts ?? []} empty="Dados de contratos não disponíveis." columns={[
        { title: 'Produto', render: (row) => <><strong>{row.product_name}</strong><small className="cell-subtitle">{row.provider}</small></> },
        { title: 'Estado / ciclo', render: (row) => `${row.status} · ${row.billing_cycle}` },
        { title: 'Assentos', render: (row) => `${row.assigned_seats} atribuídos / ${row.contracted_seats} contratados` },
        { title: 'Sem atividade', render: (row) => row.idle_seats },
        { title: 'Atividade desconhecida', render: (row) => row.unknown_activity_seats },
        { title: 'Valor contratado', render: (row) => formatMoney(row.total_contract_value, row.currency) },
      ]} />
      <div className="section-heading"><div><p className="eyebrow">IDENTIDADE CORPORATIVA</p><h2>Revisão pendente</h2></div></div>
      <DataTable rows={data?.pendingIdentities ?? []} empty="Nenhuma identidade pendente de revisão." columns={[
        { title: 'Provedor / ID externo', render: (row) => <>{row.provider}<small className="cell-subtitle">{row.external_user_id}</small></> },
        { title: 'E-mail externo', render: (row) => row.external_email ?? 'Não informado' },
        { title: 'Nome', render: (row) => row.display_name ?? '—' },
        { title: 'Associação', render: (row) => hasPermission(role, 'members:manage') ? <div className="match-control"><label>Membro<select aria-label={`Membro correspondente a ${row.external_user_id}`} value={selectedUsers[row.id] ?? ''} onChange={(event) => setSelectedUsers({ ...selectedUsers, [row.id]: event.target.value })}><option value="">Selecionar membro</option>{(members?.items ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} · {member.email}</option>)}</select></label><button className="button small primary" disabled={!selectedUsers[row.id]} onClick={() => void matchIdentity(row.id)}>Associar</button></div> : <Badge tone="warning">Requer members:manage</Badge> },
      ]} />
    </>}
  </PageFrame>;
}

function ProjectsPage() {
  const { token, orgId, role } = useDashboard();
  const projectsPath = `/v1/organizations/${orgId}/projects`;
  const teamsPath = `/v1/organizations/${orgId}/teams`;
  const projects = useResource<Resource<ProjectRow>>(projectsPath, token);
  const teams = useResource<Resource<TeamRow>>(teamsPath, token);
  const canManageProjects = hasPermission(role, 'projects:manage');
  const canManageTeams = hasPermission(role, 'teams:manage');
  const canManageMembers = hasPermission(role, 'members:manage');
  const { config } = useAuth();
  const members = useResource<Resource<MemberRow>>(canManageMembers ? `/v1/organizations/${orgId}/memberships` : null, token);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [teamMember, setTeamMember] = useState('');
  const [teamId, setTeamId] = useState('');
  const refresh = () => { projects.reload(); teams.reload(); members.reload(); };
  const createProject: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(projectsPath, token, jsonBody({
        name: String(form.get('name')),
        slug: slugify(String(form.get('name'))),
        teamId: String(form.get('teamId')) || undefined,
        description: String(form.get('description')) || undefined,
      }));
      setMessage('Projeto criado.');
      formElement.reset();
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar projeto'); }
    finally { setBusy(false); }
  };
  const createTeam: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(teamsPath, token, jsonBody({ name: String(form.get('name')), slug: slugify(String(form.get('name'))) }));
      setMessage('Equipe criada.');
      formElement.reset();
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar equipe'); }
    finally { setBusy(false); }
  };
  const addTeamMember = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/teams/${teamId}/memberships`, token, jsonBody({ userId: teamMember }));
      setMessage('Membro associado à equipe.');
      setTeamMember('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao associar membro'); }
    finally { setBusy(false); }
  };
  const inviteMember: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/memberships`, token, jsonBody({
        email: String(form.get('email')), fullName: String(form.get('fullName')), role: String(form.get('role')),
      }));
      setMessage('Membro convidado/atualizado.');
      formElement.reset();
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao atualizar membro'); }
    finally { setBusy(false); }
  };

  const setMemberPassword: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/users/${String(form.get('userId'))}/password`, token, jsonBody({ newPassword: String(form.get('newPassword')) }));
      setMessage('Senha temporária definida; o usuário precisará trocá-la no próximo login.');
      formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao definir senha'); }
    finally { setBusy(false); }
  };

  return <PageFrame title="Projetos e equipes" subtitle="Organize o consumo com escopo de projeto, equipe e membros">
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    {(projects.loading || teams.loading) ? <Spinner label="Carregando estrutura da organização" /> : <>
      <div className="two-column">
        <section><div className="section-heading compact"><div><p className="eyebrow">PROJETOS</p><h2>Projetos cadastrados</h2></div></div>
          <DataTable rows={projects.data?.items ?? []} empty="Nenhum projeto cadastrado." columns={[
            { title: 'Projeto', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.slug}</small></> },
            { title: 'Descrição', render: (row) => row.description ?? '—' },
            { title: 'Equipe', render: (row) => teams.data?.items.find((team) => team.id === row.team_id)?.name ?? 'Sem equipe' },
          ]} />
          {canManageProjects && <form className="form-card" onSubmit={(event) => void createProject(event)}><h3>Criar projeto</h3><label>Nome do projeto<input name="name" required /></label><label>Descrição (opcional)<input name="description" /></label><label>Equipe<select name="teamId" defaultValue=""><option value="">Sem equipe</option>{(teams.data?.items ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button className="button primary" disabled={busy}>Criar projeto</button></form>}
        </section>
        <section><div className="section-heading compact"><div><p className="eyebrow">EQUIPES</p><h2>Equipes cadastradas</h2></div></div>
          <DataTable rows={teams.data?.items ?? []} empty="Nenhuma equipe cadastrada." columns={[
            { title: 'Equipe', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.slug}</small></> },
            { title: 'Criada em', render: (row) => formatDate(row.created_at) },
          ]} />
          {canManageTeams && <form className="form-card" onSubmit={(event) => void createTeam(event)}><h3>Criar equipe</h3><label>Nome da equipe<input name="name" required /></label><button className="button primary" disabled={busy}>Criar equipe</button></form>}
        </section>
      </div>
      {canManageMembers && <section className="two-column">
        <form className="form-card" onSubmit={(event) => void inviteMember(event)}><h3>Adicionar membro à organização</h3><label>E-mail corporativo<input type="email" name="email" required /></label><label>Nome completo<input name="fullName" /></label><label>Papel<select name="role" defaultValue="developer"><option value="owner">Owner</option><option value="admin">Admin</option><option value="finops">FinOps</option><option value="security">Security</option><option value="developer">Developer</option><option value="viewer">Viewer</option></select></label><button className="button primary" disabled={busy}>Salvar membro</button></form>
        <div className="form-card"><h3>Associar membro à equipe</h3><label>Equipe<select value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">Selecionar equipe</option>{(teams.data?.items ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Membro<select value={teamMember} onChange={(event) => setTeamMember(event.target.value)}><option value="">Selecionar membro</option>{(members.data?.items ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} · {member.email}</option>)}</select></label><button className="button primary" disabled={!teamId || !teamMember || busy} onClick={() => void addTeamMember()}>Associar</button></div>
      </section>}
      {canManageMembers && config?.localEnabled && <section className="two-column">
        <form className="form-card" onSubmit={(event) => void setMemberPassword(event)}><h3>Definir senha de membro (login local)</h3><label>Membro<select name="userId" required defaultValue=""><option value="">Selecionar membro</option>{(members.data?.items ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} · {member.email}</option>)}</select></label><label>Senha temporária<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>Mínimo de 12 caracteres. O membro deverá trocá-la no primeiro login.</small></label><button className="button primary" disabled={busy}>Definir senha</button></form>
      </section>}
    </>}
  </PageFrame>;
}

function VirtualKeysPage() {
  const { token, orgId, role } = useDashboard();
  const path = `/v1/organizations/${orgId}/virtual-keys`;
  const keys = useResource<Resource<VirtualKeyRow>>(path, token);
  const projects = useResource<Resource<ProjectRow>>(`/v1/organizations/${orgId}/projects`, token);
  const teams = useResource<Resource<TeamRow>>(`/v1/organizations/${orgId}/teams`, token);
  const canManage = hasPermission(role, 'virtual_keys:manage');
  const [error, setError] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scopeType, setScopeType] = useState<'project' | 'team' | 'user'>('project');
  const members = useResource<Resource<MemberRow>>(
    canManage ? `/v1/organizations/${orgId}/virtual-keys/owners` : null,
    token,
  );
  const createKey: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(null); setOneTimeSecret(null); setBusy(true);
    try {
      const created = await apiRequest<VirtualKeyRow & { api_key: string }>(path, token, jsonBody({
        name: String(form.get('name')),
        scopeType,
        ...(scopeType === 'project' ? { projectId: String(form.get('projectId')) } : {}),
        ...(scopeType === 'team' ? { teamId: String(form.get('teamId')) } : {}),
        ...(scopeType === 'user' ? { userId: String(form.get('userId')) } : {}),
        allowedProviders: String(form.get('providers')).split(',').map((item) => item.trim()).filter(Boolean),
        allowedModels: String(form.get('models')).split(',').map((item) => item.trim()).filter(Boolean),
        scopes: ['chat:completions'],
        maxRequestsPerMinute: form.get('rpm') ? Number(form.get('rpm')) : null,
      }));
      setOneTimeSecret(created.api_key);
      formElement.reset();
      setScopeType('project');
      keys.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar chave'); }
    finally { setBusy(false); }
  };
  const revoke = async (key: VirtualKeyRow) => {
    if (!window.confirm(`Revogar a chave ${key.name} (${key.key_prefix})?`)) return;
    setError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/virtual-keys/${key.id}/revoke`, token, { method: 'POST' });
      keys.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao revogar chave'); }
  };
  return <PageFrame title="Chaves virtuais" subtitle="Segredos exibidos somente na criação; a API mantém apenas hash e prefixo">
    {error && <Notice tone="error">{error}</Notice>}
    {members.error && <Notice tone="error">Não foi possível carregar as pessoas disponíveis: {members.error}</Notice>}
    {teams.error && <Notice tone="error">Não foi possível carregar as equipes disponíveis: {teams.error}</Notice>}
    {oneTimeSecret && <Notice tone="success"><strong>Copie agora; o segredo não será mostrado novamente:</strong><code className="secret-value">{oneTimeSecret}</code><button className="button small" onClick={() => void navigator.clipboard.writeText(oneTimeSecret)}>Copiar</button><button className="icon-button" onClick={() => setOneTimeSecret(null)} aria-label="Fechar segredo">×</button></Notice>}
    {canManage && <form className="form-card form-grid" onSubmit={(event) => void createKey(event)}><h3>Gerar chave virtual</h3><label>Nome<input name="name" required /></label><label>Tipo de vínculo<select name="scopeType" value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)}><option value="project">Projeto</option><option value="team">Equipe</option><option value="user">Pessoa</option></select></label>{scopeType === 'project' && <label>Projeto<select name="projectId" required defaultValue=""><option value="">Selecione</option>{(projects.data?.items ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}{scopeType === 'team' && <label>Equipe<select name="teamId" required defaultValue=""><option value="">Selecione</option>{(teams.data?.items ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}{scopeType === 'user' && <label>Pessoa<select name="userId" required defaultValue=""><option value="">Selecione</option>{(members.data?.items ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} · {member.email}</option>)}</select><small>A chave pessoal é atribuída à equipe da pessoa, se houver.</small></label>}<label>Provedores permitidos<input name="providers" defaultValue="ollama" /><small>Separe vários provedores por vírgula.</small></label><label>Modelos permitidos<input name="models" /><small>Opcional; vazio permite qualquer modelo autorizado pelo provedor.</small></label><label>Limite de chamadas por minuto<input name="rpm" type="number" min="1" /><small>Opcional; sem valor não aplica limite específico à chave.</small></label><button className="button primary" disabled={busy}>Criar chave</button></form>}
    {keys.loading ? <Spinner label="Carregando chaves" /> : keys.error ? <PageError message={keys.error} retry={keys.reload} /> : <DataTable rows={keys.data?.items ?? []} empty="Nenhuma chave virtual cadastrada." columns={[
      { title: 'Chave', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.key_prefix}…</small></> },
      { title: 'Escopo', render: (row) => row.scope_type === 'project'
        ? `Projeto · ${row.project_name ?? row.project_id}`
        : row.scope_type === 'team'
          ? `Equipe · ${row.team_name ?? row.team_id}`
          : `Pessoa · ${row.user_name ?? row.owner_user_id}` },
      { title: 'Permissões', render: (row) => <>{row.allowed_providers.join(', ')}<small className="cell-subtitle">{row.allowed_models.length ? row.allowed_models.join(', ') : 'Todos os modelos'}</small></> },
      { title: 'Limite', render: (row) => row.max_requests_per_minute ? `${row.max_requests_per_minute} req/min` : 'Sem limite' },
      { title: 'Estado', render: (row) => <Badge tone={row.revoked_at ? 'neutral' : 'success'}>{row.revoked_at ? 'Revogada' : 'Ativa'}</Badge> },
      { title: '', render: (row) => canManage && !row.revoked_at ? <button className="button small danger" onClick={() => void revoke(row)}>Revogar</button> : null },
    ]} />}
  </PageFrame>;
}

function TestChatPage() {
  const { token, orgId } = useDashboard();
  const keys = useResource<Resource<VirtualKeyRow>>(`/v1/organizations/${orgId}/virtual-keys`, token);
  const activeKeys = (keys.data?.items ?? []).filter((key) => !key.revoked_at);
  const [keyId, setKeyId] = useState('');
  const selectedKey = activeKeys.find((key) => key.id === keyId);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [stream, setStream] = useState(true);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedKey) {
      setModel('');
      return;
    }
    if (selectedKey.allowed_models.length) {
      if (!selectedKey.allowed_models.includes(model)) setModel(selectedKey.allowed_models[0] ?? '');
      return;
    }
    const defaultModel = selectedKey.allowed_providers.includes('ollama')
      ? 'llama3.2'
      : selectedKey.allowed_providers.includes('gemini')
        ? 'gemini-2.0-flash'
        : '';
    if (!model || (model.startsWith('gemini-') && !selectedKey.allowed_providers.includes('gemini'))) {
      setModel(defaultModel);
    }
  }, [model, selectedKey]);

  const submit: Action = async (event) => {
    event.preventDefault();
    if (!selectedKey) return;
    setBusy(true);
    setError(null);
    setResponse('');
    const path = `/v1/organizations/${orgId}/virtual-keys/${selectedKey.id}/test-chat`;
    const body = {
      model,
      messages: [{ role: 'user', content: message }],
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      store: false,
    };
    try {
      if (stream) {
        await apiStream(path, token, body, (chunk) => setResponse((current) => current + chunk));
      } else {
        const result = await apiRequest<{
          choices?: Array<{ message?: { content?: string } }>;
        }>(path, token, jsonBody(body));
        setResponse(result.choices?.[0]?.message?.content ?? 'Resposta sem conteúdo');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao executar o teste');
    } finally {
      setBusy(false);
    }
  };

  return <PageFrame title="Chat de teste" subtitle="Teste integrações e modelos autorizados para uma chave virtual sem revelar o segredo">
    {keys.error && <Notice tone="error">{keys.error}</Notice>}
    {keys.loading ? <Spinner label="Carregando chaves virtuais" /> : !activeKeys.length
      ? <EmptyState>Não há chaves ativas disponíveis para teste.</EmptyState>
      : <section className="two-column">
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <h3>Executar teste</h3>
          <p className="muted">Somente administradores podem testar. Chamadas seguem os limites, políticas e guardrails da chave e geram consumo real.</p>
          <label>Chave virtual<select value={keyId} onChange={(event) => setKeyId(event.target.value)} required>
            <option value="">Selecione uma chave</option>
            {activeKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.scope_type} · {key.key_prefix}…</option>)}
          </select></label>
          {selectedKey && <p className="muted">Provedores permitidos: {selectedKey.allowed_providers.join(', ')}. {selectedKey.allowed_models.length ? `Modelos: ${selectedKey.allowed_models.join(', ')}.` : 'Informe um modelo permitido pelo provedor.'}</p>}
          <label>Modelo{selectedKey?.allowed_models.length
            ? <select value={model} onChange={(event) => setModel(event.target.value)} required>
                {selectedKey.allowed_models.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            : <input value={model} onChange={(event) => setModel(event.target.value)} required placeholder={selectedKey?.allowed_providers.includes('azure-openai') ? 'Nome da implantação Foundry' : 'ex.: llama3.2'} />}</label>
          <label>Mensagem<textarea value={message} onChange={(event) => setMessage(event.target.value)} required rows={5} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} /> Receber resposta em streaming</label>
          <button className="button primary" disabled={busy || !keyId || !model || !message.trim()}>{busy ? 'Aguardando resposta…' : 'Enviar teste'}</button>
        </form>
        <section className="form-card"><h3>Resposta</h3>{error && <Notice tone="error">{error}</Notice>}{busy && !response && <Spinner label="Executando inferência" />}{response ? <pre className="chat-response">{response}</pre> : !busy && !error ? <p className="muted">A resposta aparecerá aqui.</p> : null}</section>
      </section>}
  </PageFrame>;
}

function GuardrailsPage() {
  const { token, orgId, role } = useDashboard();
  const rules = useResource<Resource<GuardrailRuleRow>>(`/v1/organizations/${orgId}/guardrail-rules`, token);
  const alerts = useResource<Resource<GuardrailAlertRow>>(`/v1/organizations/${orgId}/guardrail-alerts`, token);
  const canManage = hasPermission(role, 'guardrails:manage');
  const [ruleType, setRuleType] = useState<'deterministic' | 'intelligent'>('deterministic');
  const [mode, setMode] = useState<'runtime' | 'async'>('runtime');
  const [scopeType, setScopeType] = useState('organization');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createRule: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/guardrail-rules`, token, jsonBody({
        name: String(form.get('name')),
        description: String(form.get('description') ?? ''),
        ruleType,
        mode,
        scopeType,
        ...(scopeType === 'organization' ? {} : { scopeId: String(form.get('scopeId')) }),
        terms: ruleType === 'deterministic'
          ? String(form.get('terms')).split(/\r?\n/).map((term) => term.trim()).filter(Boolean)
          : [],
        ...(ruleType === 'intelligent' ? {
          evaluatorProvider: String(form.get('evaluatorProvider')),
          evaluatorModel: String(form.get('evaluatorModel')),
          evaluatorPrompt: String(form.get('evaluatorPrompt')),
        } : {}),
        severity: String(form.get('severity')),
      }));
      formElement.reset();
      rules.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar guardrail');
    } finally {
      setBusy(false);
    }
  };

  const setRuleActive = async (rule: GuardrailRuleRow) => {
    setError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/guardrail-rules/${rule.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !rule.is_active }),
      });
      rules.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar guardrail');
    }
  };

  const updateAlert = async (alert: GuardrailAlertRow, status: 'acknowledged' | 'resolved') => {
    setError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/guardrail-alerts/${alert.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      alerts.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar alerta');
    }
  };

  return <PageFrame title="Guardrails" subtitle="Regras de conteúdo, avaliações inteligentes e alertas de violações">
    {error && <Notice tone="error">{error}</Notice>}
    {canManage && <form className="form-card form-grid" onSubmit={(event) => void createRule(event)}>
      <h3>Criar regra</h3>
      <label>Nome<input name="name" required maxLength={120} /></label>
      <label>Descrição<input name="description" maxLength={500} /></label>
      <label>Tipo<select value={ruleType} onChange={(event) => setRuleType(event.target.value as typeof ruleType)}><option value="deterministic">Termos fixos</option><option value="intelligent">Análise inteligente por LLM</option></select></label>
      <label>Modo<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="runtime">Runtime — antes da inferência</option><option value="async">Assíncrono — alerta posterior</option></select></label>
      <label>Escopo<select value={scopeType} onChange={(event) => setScopeType(event.target.value)}><option value="organization">Organização</option><option value="project">Projeto</option><option value="team">Equipe</option><option value="user">Pessoa</option><option value="virtual_key">Chave virtual</option></select></label>
      {scopeType !== 'organization' && <label>ID do alvo<input name="scopeId" required placeholder="UUID do escopo" /></label>}
      {ruleType === 'deterministic'
        ? <label>Termos/frases bloqueados<textarea name="terms" required rows={4} placeholder="Um termo ou frase por linha" /><small>Correspondência sem diferenciar maiúsculas/minúsculas.</small></label>
        : <><label>Provedor avaliador<select name="evaluatorProvider"><option value="ollama">Ollama</option><option value="gemini">Gemini</option><option value="azure-openai">Azure OpenAI (Foundry)</option></select></label><label>Modelo avaliador<input name="evaluatorModel" required placeholder="llama3.2, gpt-4.1-mini ou gemini-..." /></label><label>Prompt da análise<textarea name="evaluatorPrompt" required rows={4} maxLength={4000} /><small>O avaliador recebe somente a mensagem atual do usuário. Falha, timeout ou decisão inválida bloqueia em modo runtime.</small></label></>}
      <label>Severidade<select name="severity" defaultValue="medium"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
      <button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Criar guardrail'}</button>
    </form>}
    <section className="section-block"><h3>Regras configuradas</h3>
      {rules.loading ? <Spinner label="Carregando regras" /> : rules.error ? <PageError message={rules.error} retry={rules.reload} /> : <DataTable rows={rules.data?.items ?? []} empty="Nenhuma regra cadastrada." columns={[
        { title: 'Regra', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.rule_type === 'deterministic' ? row.terms.join(', ') : `${row.evaluator_provider} · ${row.evaluator_model}`}</small></> },
        { title: 'Modo / escopo', render: (row) => `${row.mode} · ${row.scope_type}` },
        { title: 'Severidade', render: (row) => row.severity },
        { title: 'Estado', render: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Ativa' : 'Inativa'}</Badge> },
        { title: '', render: (row) => canManage ? <button className="button small" onClick={() => void setRuleActive(row)}>{row.is_active ? 'Desativar' : 'Ativar'}</button> : null },
      ]} />}
    </section>
    <section className="section-block"><h3>Alertas — retenção de 30 dias</h3>
      {alerts.loading ? <Spinner label="Carregando alertas" /> : alerts.error ? <PageError message={alerts.error} retry={alerts.reload} /> : <DataTable rows={alerts.data?.items ?? []} empty="Nenhum alerta ativo." columns={[
        { title: 'Data', render: (row) => formatDate(row.created_at) },
        { title: 'Regra / chave', render: (row) => <>{row.rule_name}<small className="cell-subtitle">{row.virtual_key_name} · {row.request_id}</small></> },
        { title: 'Resultado', render: (row) => <Badge tone={row.outcome === 'violation' ? 'danger' : 'warning'}>{row.outcome} · {row.severity}</Badge> },
        { title: 'Detalhe', render: (row) => row.reason ?? 'Sem justificativa' },
        { title: 'Estado', render: (row) => row.status },
        { title: '', render: (row) => canManage && row.status !== 'resolved' ? <div className="button-row"><button className="button small" onClick={() => void updateAlert(row, 'acknowledged')}>Reconhecer</button><button className="button small" onClick={() => void updateAlert(row, 'resolved')}>Resolver</button></div> : null },
      ]} />}
    </section>
  </PageFrame>;
}

function BudgetsPage() {
  const { token, orgId, role } = useDashboard();
  const path = useFiltersPath(`/v1/organizations/${orgId}/budget-policies`);
  const budgets = useResource<Resource<BudgetRow>>(path, token);
  const projects = useResource<Resource<ProjectRow>>(`/v1/organizations/${orgId}/projects`, token);
  const keys = useResource<Resource<VirtualKeyRow>>(`/v1/organizations/${orgId}/virtual-keys`, token);
  const teams = useResource<Resource<TeamRow>>(`/v1/organizations/${orgId}/teams`, token);
  const costDimensions = useResource<{ users: Array<{ id: string; full_name: string }> }>(
    hasPermission(role, 'costs:read') ? `/v1/organizations/${orgId}/costs/dimensions` : null,
    token,
  );
  const canManage = hasPermission(role, 'budgets:manage');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState('organization');
  const createBudget: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scopeType = String(form.get('scopeType'));
    setError(null); setMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/budget-policies`, token, jsonBody({
        name: String(form.get('name')), scopeType, mode: String(form.get('mode')),
        currency: String(form.get('currency')).toUpperCase(), limitAmount: String(form.get('limitAmount')),
        alertThresholdPercent: String(form.get('alertThresholdPercent') || '80'),
        projectId: scopeType === 'project' ? String(form.get('projectId')) : undefined,
        virtualKeyId: scopeType === 'virtual_key' ? String(form.get('virtualKeyId')) : undefined,
        teamId: scopeType === 'team' ? String(form.get('teamId')) : undefined,
        userId: scopeType === 'user' ? String(form.get('userId')) : undefined,
        periodStart: String(form.get('periodStart')), periodEnd: String(form.get('periodEnd')),
      }));
      setMessage('Política de orçamento criada.');
      formElement.reset();
      budgets.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar política'); }
  };
  const changeMode = async (policy: BudgetRow, mode: string) => {
    setError(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/budget-policies/${policy.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      });
      budgets.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao atualizar política'); }
  };
  return <PageFrame title="Orçamentos" subtitle="Políticas cumulativas por organização, projeto, chave, equipe e pessoa">
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    {canManage && <form className="form-card form-grid" onSubmit={(event) => void createBudget(event)}>
      <h3>Criar política</h3>
      <label>Nome da política<input name="name" required /></label>
      <label>Escopo<select name="scopeType" value={scopeType} onChange={(event) => setScopeType(event.target.value)}><option value="organization">Organização</option><option value="project">Projeto</option><option value="virtual_key">Chave virtual</option><option value="team">Equipe</option><option value="user">Pessoa</option></select><small>O limite se acumula com as políticas aplicáveis dos demais escopos.</small></label>
      <label>Modo<select name="mode" defaultValue="observe"><option value="observe">Observação — permite chamadas, sem alerta</option><option value="alert">Alerta — permite chamadas e registra o limiar</option><option value="block">Bloqueio — recusa chamadas ao exceder o limite</option></select></label>
      <label>Moeda<input name="currency" defaultValue="USD" maxLength={3} required /><small>Código ISO 4217, por exemplo USD ou BRL.</small></label>
      <label>Limite máximo de gastos<input name="limitAmount" type="number" min="0.000001" step="0.000001" required /><small>Valor máximo contabilizado durante o período, na moeda selecionada.</small></label>
      <label>Limiar de alerta (%)<input name="alertThresholdPercent" type="number" min="1" max="100" defaultValue="80" /><small>Percentual do limite que dispara o alerta; não é um segundo orçamento.</small></label>
      {scopeType === 'project' && <label>Projeto<select name="projectId" required defaultValue=""><option value="">Selecione</option>{(projects.data?.items ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
      {scopeType === 'virtual_key' && <label>Chave virtual<select name="virtualKeyId" required defaultValue=""><option value="">Selecione</option>{(keys.data?.items ?? []).map((key) => <option key={key.id} value={key.id}>{key.name} · {key.key_prefix}</option>)}</select></label>}
      {scopeType === 'team' && <label>Equipe<select name="teamId" required defaultValue=""><option value="">Selecione</option>{(teams.data?.items ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      {scopeType === 'user' && <label>Pessoa<select name="userId" required defaultValue=""><option value="">Selecione</option>{(costDimensions.data?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select><small>Somente chamadas de chaves explicitamente atribuídas a essa pessoa entram no limite.</small></label>}
      <label>Início do período<input name="periodStart" type="datetime-local" required /><small>Data e hora em que a janela de contabilização começa.</small></label>
      <label>Fim do período<input name="periodEnd" type="datetime-local" required /><small>Data e hora final da janela de contabilização.</small></label>
      <button className="button primary">Criar política</button>
    </form>}
    {budgets.loading ? <Spinner label="Carregando políticas" /> : budgets.error ? <PageError message={budgets.error} retry={budgets.reload} /> : <DataTable rows={budgets.data?.items ?? []} empty="Nenhuma política de orçamento cadastrada." columns={[
      { title: 'Política', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.scope_type === 'team' ? teams.data?.items.find((team) => team.id === row.team_id)?.name ?? 'Equipe' : row.scope_type === 'user' ? costDimensions.data?.users.find((user) => user.id === row.user_id)?.full_name ?? 'Pessoa' : row.scope_type}</small></> },
      { title: 'Limite', render: (row) => formatMoney(row.limit_amount, row.currency) },
      { title: 'Período', render: (row) => `${formatDate(row.period_start)} — ${formatDate(row.period_end)}` },
      { title: 'Modo', render: (row) => canManage ? <label>Modo<select aria-label={`Modo da política ${row.name}`} value={row.mode} onChange={(event) => void changeMode(row, event.target.value)}><option value="observe">Observação</option><option value="alert">Alerta</option><option value="block">Bloqueio</option></select></label> : <Badge>{row.mode}</Badge> },
      { title: 'Estado', render: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Ativa' : 'Inativa'}</Badge> },
    ]} />}
  </PageFrame>;
}

function ConnectorsPage() {
  const { token, orgId, role } = useDashboard();
  const connectionsPath = useFiltersPath(`/v1/organizations/${orgId}/provider-connections`);
  const runsPath = useFiltersPath(`/v1/organizations/${orgId}/connectors/sync-runs`);
  const connections = useResource<Resource<ConnectionRow>>(connectionsPath, token);
  const runs = useResource<Resource<SyncRow>>(runsPath, token);
  const canManage = hasPermission(role, 'connectors:manage');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createConnection: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const provider = String(form.get('provider'));
    const secretName = provider === 'openai' ? 'apiKey' : 'token';
    const credentials = { [secretName]: String(form.get('secret')) };
    const configMetadata = provider === 'github-copilot' ? { organization: String(form.get('organization')) } : {};
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(`/v1/organizations/${orgId}/provider-connections`, token, jsonBody({
        provider, name: String(form.get('name')), credentials, configMetadata,
      }));
      formElement.reset();
      setMessage('Integração cadastrada. O segredo não será exibido novamente.');
      connections.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao cadastrar integração'); }
    finally { setBusy(false); }
  };
  const syncConnection = async (connection: ConnectionRow) => {
    const start = document.querySelector<HTMLInputElement>('#sync-start')?.value || new Date(Date.now() - 7 * 86_400_000).toISOString();
    const end = document.querySelector<HTMLInputElement>('#sync-end')?.value || new Date().toISOString();
    const periodStart = start.length === 10 ? `${start}T00:00:00.000Z` : start;
    const periodEnd = end.length === 10 ? `${end}T23:59:59.999Z` : end;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await apiRequest<{ status: string; recordsProcessed: number }>(
        `/v1/organizations/${orgId}/provider-connections/${connection.id}/sync`,
        token,
        jsonBody({ dataset: connection.provider === 'openai' ? 'api_costs' : 'license_assignments', periodStart, periodEnd }),
      );
      setMessage(`Sincronização ${result.status}; ${result.recordsProcessed} registros processados.`);
      connections.reload(); runs.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na sincronização'); }
    finally { setBusy(false); }
  };
  const importCsv: Action = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) { setError('Selecione um arquivo CSV.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await apiRequest<{ status: string; recordsProcessed: number }>(
        `/v1/organizations/${orgId}/connectors/import-csv`,
        token,
        jsonBody({
          dataset: String(form.get('dataset')),
          provider: String(form.get('provider') || 'csv'),
          dryRun: form.get('dryRun') === 'on',
          csvContent: await file.text(),
        }),
      );
      setMessage(`Importação ${result.status}; ${result.recordsProcessed} registros processados.`);
      formElement.reset();
      runs.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao importar CSV'); }
    finally { setBusy(false); }
  };
  return <PageFrame title="Conectores e sincronizações" subtitle="Credenciais protegidas, execução rastreável e importação CSV com dry run">
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    {canManage && <>
      <form className="form-card form-grid" onSubmit={(event) => void createConnection(event)}><h3>Adicionar integração API</h3><label>Provedor<select name="provider" defaultValue="openai"><option value="openai">OpenAI Costs</option><option value="github-copilot">GitHub Copilot Seats</option></select></label><label>Nome da integração<input name="name" required /></label><label>Organização GitHub (Copilot)<input name="organization" /></label><label>Credencial secreta<input name="secret" type="password" autoComplete="new-password" required /></label><button className="button primary" disabled={busy}>Salvar integração</button></form>
      <form className="form-card form-grid" onSubmit={(event) => void importCsv(event)}><h3>Importar CSV</h3><label>Tipo de dados<select name="dataset" defaultValue="api_costs"><option value="api_costs">Custos de API</option><option value="license_assignments">Atribuições de licença</option><option value="usage_records">Registros de uso</option></select></label><label>Provedor<input name="provider" defaultValue="csv" /></label><label>Arquivo CSV<input name="file" type="file" accept=".csv,text/csv" required /></label><label className="checkbox-field"><input name="dryRun" type="checkbox" /> Apenas validar (dry run)</label><button className="button primary" disabled={busy}>Importar</button></form>
    </>}
    <section className="form-card sync-period"><h3>Período para sincronização manual</h3><label>Início<input id="sync-start" type="date" /></label><label>Fim<input id="sync-end" type="date" /></label></section>
    {connections.loading ? <Spinner label="Carregando integrações" /> : connections.error ? <PageError message={connections.error} retry={connections.reload} /> : <DataTable rows={connections.data?.items ?? []} empty="Nenhuma integração cadastrada." columns={[
      { title: 'Integração', render: (row) => <><strong>{row.name}</strong><small className="cell-subtitle">{row.provider} · {row.connection_type}</small></> },
      { title: 'Estado', render: (row) => <Badge tone={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge> },
      { title: 'Última sincronização', render: (row) => formatDate(row.last_synced_at) },
      { title: '', render: (row) => canManage && row.connection_type === 'api' ? <button className="button small" disabled={busy || row.status !== 'active'} onClick={() => void syncConnection(row)}>Sincronizar</button> : null },
    ]} />}
    <div className="section-heading"><div><p className="eyebrow">HISTÓRICO</p><h2>Execuções recentes</h2></div></div>
    {runs.loading ? <Spinner label="Carregando execuções" /> : runs.error ? <PageError message={runs.error} retry={runs.reload} /> : <DataTable rows={runs.data?.items ?? []} empty="Nenhuma execução registrada." columns={[
      { title: 'Início', render: (row) => formatDate(row.started_at) },
      { title: 'Dataset / origem', render: (row) => <>{row.dataset}<small className="cell-subtitle">{connections.data?.items.find((connection) => connection.id === row.provider_connection_id)?.provider ?? 'CSV'}</small></> },
      { title: 'Estado', render: (row) => <Badge tone={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}>{row.status}</Badge> },
      { title: 'Processados / criados / falhas', render: (row) => `${row.records_processed} / ${row.records_created} / ${row.records_failed}` },
      { title: 'Período', render: (row) => row.period_start && row.period_end ? `${formatDate(row.period_start)} — ${formatDate(row.period_end)}` : 'Não informado' },
    ]} />}
  </PageFrame>;
}

function AuditPage() {
  const { token, orgId } = useDashboard();
  const path = useFiltersPath(`/v1/organizations/${orgId}/audit-events`);
  const { data, loading, error, reload } = useResource<Resource<AuditRow>>(path, token);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const items = (data?.items ?? []).filter((row) =>
    (!actionFilter || row.action.toLowerCase().includes(actionFilter.toLowerCase())) &&
    (!actorFilter || (row.actor_email ?? row.actor_user_id ?? '').toLowerCase().includes(actorFilter.toLowerCase())),
  );
  return <PageFrame title="Auditoria" subtitle="Eventos administrativos filtráveis por ação, usuário e período">
    <div className="audit-filters"><label>Ação<input value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} placeholder="Buscar ação" /></label><label>Usuário<input value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} placeholder="E-mail ou ID do usuário" /></label></div>
    {loading ? <Spinner label="Carregando auditoria" /> : error ? <PageError message={error} retry={reload} /> : <DataTable rows={items} empty="Nenhum evento corresponde aos filtros atuais." columns={[
      { title: 'Data', render: (row) => formatDate(row.created_at) },
      { title: 'Ação', render: (row) => <Badge>{row.action}</Badge> },
      { title: 'Usuário', render: (row) => row.actor_email ?? row.actor_user_id ?? 'Sistema' },
      { title: 'Alvo', render: (row) => `${row.target_type} · ${row.target_id}` },
      { title: 'Detalhes', render: (row) => <code>{JSON.stringify(row.metadata)}</code> },
    ]} />}
  </PageFrame>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (location.pathname === '/auth/callback') return <LoginCallback />;
  if (loading) return <main className="centered"><Spinner label="Inicializando autenticação" /></main>;
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/costs" element={<CostsPage />} />
        <Route path="/licenses" element={<LicensesPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/virtual-keys" element={<VirtualKeysPage />} />
        <Route path="/test-chat" element={<TestChatPage />} />
        <Route path="/guardrails" element={<GuardrailsPage />} />
        <Route path="/budgets" element={<BudgetsPage />} />
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/account/password" element={<PageFrame title="Minha conta" subtitle="Troque sua senha de acesso local"><PasswordChangeForm forced={false} /></PageFrame>} />
        <Route path="*" element={<EmptyState>Página não encontrada.</EmptyState>} />
      </Route>
    </Routes>
  );
}

export function App() {
  return <AuthProvider><BrowserRouter><AppRoutes /></BrowserRouter></AuthProvider>;
}

function PageFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <div className="page-stack"><div className="section-heading"><div><p className="eyebrow">GOVERNANÇA</p><h2>{title}</h2><p className="muted">{subtitle}</p></div></div>{children}</div>;
}

function DataTable<T>({ rows, columns, empty }: { rows: T[]; columns: Array<{ title: string; render: (row: T) => ReactNode }>; empty: string }) {
  if (!rows.length) return <div className="table-empty">{empty}</div>;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column, index) => <th key={`${column.title}-${index}`}>{column.title}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={getRowKey(row, rowIndex)}>{columns.map((column, columnIndex) => <td key={`${column.title}-${columnIndex}`}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}

function getRowKey(row: unknown, index: number): string {
  if (row && typeof row === 'object') {
    const record = row as Record<string, unknown>;
    const key = record.id ?? record.project_id ?? record.team_id ?? record.provider;
    if (key) return String(key);
  }
  return String(index);
}

function Spinner({ label }: { label: string }) { return <div className="loading"><span className="spinner" />{label}</div>; }
function EmptyState({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
function PageError({ message, retry }: { message: string; retry: () => void }) { return <div className="error-block"><Notice tone="error">{message}</Notice><button className="button" onClick={retry}>Tentar novamente</button></div>; }
function Notice({ tone, children }: { tone: 'success' | 'error' | 'warning'; children: ReactNode }) { return <div className={`notice ${tone}`}>{children}</div>; }
function Badge({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Progress({ value, mode }: { value: number | null; mode: string }) { if (value == null || !Number.isFinite(value)) return <span>Dados não disponíveis</span>; const bounded = Math.max(0, Math.min(100, value)); return <div className="progress-cell"><span>{value.toFixed(1)}% · {mode}</span><div className="progress-track"><span className={value >= 100 || mode === 'block' ? 'critical' : value >= 80 ? 'warning' : ''} style={{ width: `${bounded}%` }} /></div></div>; }

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function nullableNumber(value: string | number | null) { return value == null ? 'Dados não disponíveis' : Number(value).toLocaleString('pt-BR'); }
function nullableSum(a: string | null, b: string | null) { return a == null && b == null ? 'Dados não disponíveis' : (Number(a ?? 0) + Number(b ?? 0)).toLocaleString('pt-BR'); }
function costCategoryLabel(value: string) {
  return ({ gateway_estimated: 'Estimado pelo gateway', guardrail_evaluation: 'Avaliação de guardrail (LLM)', provider_reported: 'Reportado', license_contracted: 'Licença contratada', financial_adjustment: 'Ajuste financeiro', unreconciled: 'Não reconciliado' } as Record<string, string>)[value] ?? value;
}

type OverviewCostRow = { cost_category: string; currency: string; is_simulated: boolean; amount: string; record_count: number };
type OverviewData = {
  period: { startDate: string; endDate: string };
  currencyNote: string;
  costsByCategory: OverviewCostRow[];
  consumptionByProviderModel: Array<{ provider: string; model: string; request_count: number; input_tokens: string | null; output_tokens: string | null; duration_ms: string | null }>;
  consumptionByProject: Array<{ project_id: string; project_name: string; request_count: number; input_tokens: string | null; output_tokens: string | null }>;
  consumptionByTeam: Array<{ team_id: string; team_name: string; request_count: number; input_tokens: string | null; output_tokens: string | null }>;
  budgets: Array<{ id: string; name: string; scope_type: string; mode: string; currency: string; limit_amount: string; spent_amount: string | null; utilization_percent: number | string | null }>;
  licenses: Array<{ id: string; provider: string; product_name: string; contracted_seats: number; assigned_seats: number; idle_seats: number; unknown_activity_seats: number }>;
  sources: Array<{ id: string; provider: string; name: string; connection_type: string; status: string; last_synced_at: string | null; last_run_status: string | null; last_run_at: string | null; is_stale: boolean }>;
  pendingReconciliation: Array<{ currency: string; record_count: number; amount: string }>;
};
type UsageRow = { id: string; projectId: string | null; projectName?: string | null; teamName?: string | null; userName?: string | null; provider: string; model: string; inputTokens: number | null; outputTokens: number | null; durationMs: number | null; status: string; source: 'gateway' | 'dashboard_test'; testActorUserId: string | null; clientOrigin?: string | null; testActorName?: string | null; createdAt: string; contentCaptured?: boolean };
type PrivacySettings = { prompt_capture_enabled: boolean; prompt_capture_retention_days: number };
type StoredContent = { messages: Array<{ role: string; content: string }>; response: string };
type CostRow = { costCategory: string; currency: string; isSimulated: boolean; amount: string; recordCount: number };
type CostModelRow = { provider: string; model: string | null; cost_category: string; is_simulated: boolean; currency: string; amount: string; record_count: number; project_id: string | null; project_name: string | null; team_id: string | null; team_name: string | null; user_id: string | null; user_name: string | null };
type LicenseContract = { id: string; provider: string; product_name: string; contracted_seats: number; assigned_seats: number; idle_seats: number; unknown_activity_seats: number; currency: string; total_contract_value: string; billing_cycle: string; status: string };
type PendingIdentity = { id: string; provider: string; external_user_id: string; external_email: string | null; display_name: string | null };
type LicenseData = { contracts: LicenseContract[]; pendingIdentities: PendingIdentity[] };
type ProjectRow = { id: string; name: string; slug: string; team_id: string | null; description: string | null };
type TeamRow = { id: string; name: string; slug: string; created_at: string };
type MemberRow = { user_id: string; full_name: string; email: string; role: Role };
type VirtualKeyRow = { id: string; name: string; scope_type: 'project' | 'team' | 'user'; project_id: string | null; team_id: string | null; owner_user_id: string | null; project_name?: string | null; team_name?: string | null; user_name?: string | null; key_prefix: string; allowed_providers: string[]; allowed_models: string[]; scopes: string[]; max_requests_per_minute: number | null; revoked_at: string | null };
type GuardrailRuleRow = { id: string; name: string; description: string | null; rule_type: 'deterministic' | 'intelligent'; mode: 'runtime' | 'async'; scope_type: string; scope_id: string | null; terms: string[]; evaluator_provider: string | null; evaluator_model: string | null; evaluator_prompt: string | null; severity: string; is_active: boolean };
type GuardrailAlertRow = { id: string; guardrail_rule_id: string; rule_name: string; virtual_key_id: string; virtual_key_name: string; request_id: string; actor_user_id: string | null; actor_name: string | null; usage_event_id: string | null; mode: 'runtime' | 'async'; outcome: 'violation' | 'inconclusive' | 'failed'; severity: string; status: 'open' | 'acknowledged' | 'resolved'; reason: string | null; created_at: string; expires_at: string };
type BudgetRow = { id: string; name: string; scope_type: string; team_id: string | null; user_id: string | null; mode: 'observe' | 'alert' | 'block'; currency: string; limit_amount: string; period_start: string; period_end: string; is_active: boolean };
type ConnectionRow = { id: string; provider: string; name: string; connection_type: string; status: string; last_synced_at: string | null };
type SyncRow = { id: string; provider_connection_id: string | null; dataset: string; status: string; period_start: string | null; period_end: string | null; records_processed: number; records_created: number; records_failed: number; started_at: string };
type AuditRow = { id: string; action: string; actor_user_id: string | null; actor_email?: string; target_type: string; target_id: string; metadata: Record<string, unknown>; created_at: string };
