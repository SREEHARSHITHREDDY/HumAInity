import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../layouts/AppShell';
import { useFetch } from '../hooks/useApi';
import { Panel, Badge, Input, Table, TH, TD, Spinner, Empty, Banner } from '../components/ui';
import { hrs } from '../lib/format';
import type { Employee } from '../lib/types';

export default function People() {
  const { data, loading } = useFetch<Employee[]>('/hr/employees');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('ALL');

  const all = data ?? [];
  const depts = [...new Set(all.map((e) => e.departmentName))].sort();
  const rows = all.filter((e) =>
    (dept === 'ALL' || e.departmentName === dept) &&
    (`${e.firstName} ${e.lastName} ${e.empCode} ${e.designation}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <Page title="People" description={`${all.length} active staff. Where a scheduling restriction applies you can see that it exists, and the dates it covers — never the reason.`}>
      <Banner tone="restricted">
        Restriction labels on this page are the firewall's output. The underlying
        occupational health assessment is not reachable from here by anyone.
      </Banner>

      <Panel title="Directory" actions={
        <div className="flex gap-2">
          <select value={dept} onChange={(e) => setDept(e.target.value)}
                  className="h-8 px-2 rounded-[4px] border border-ink-30 text-[13px] bg-white">
            <option value="ALL">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code"
                 className="h-8 w-48 text-[13px]" />
        </div>}>
        {loading ? <div className="py-16 grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>
          : rows.length === 0 ? <Empty title="No one matches that search">Try a different name, code or department.</Empty>
          : (
            <Table>
              <thead><tr>
                <TH>Staff member</TH><TH>Department</TH><TH>Contract</TH>
                <TH align="right">Hours/week</TH><TH>Scheduling restrictions</TH>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <TD>
                      <Link to={`/people/${e.id}`} className="font-medium hover:text-signal">
                        {e.firstName} {e.lastName}
                      </Link>
                      <span className="block text-[11.5px] text-ink-50">{e.empCode} · {e.designation}</span>
                    </TD>
                    <TD className="text-[13px]">{e.departmentName}</TD>
                    <TD><Badge tone={e.employmentType === 'FULL_TIME' ? 'neutral' : 'signal'}>
                      {e.employmentType === 'FULL_TIME' ? 'Full time' : `Part time · ${e.contractedFte} FTE`}
                    </Badge></TD>
                    <TD align="right"><span className="num">{hrs(e.contractedHoursPerWeek)}</span></TD>
                    <TD>
                      {e.restrictions.length === 0
                        ? <span className="text-[12.5px] text-ink-50">None</span>
                        : <div className="flex flex-wrap gap-1">
                            {e.restrictions.map((r) => (
                              <Badge key={r.opaqueRef} tone="restricted" className="max-w-[230px]">
                                {r.description}
                              </Badge>
                            ))}
                          </div>}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Panel>
    </Page>
  );
}
