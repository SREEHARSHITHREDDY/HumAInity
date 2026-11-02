import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AppShell from './layouts/AppShell';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MySchedule from './pages/MySchedule';
import Rosters from './pages/Rosters';
import People from './pages/People';
import PersonDetail from './pages/PersonDetail';
import Leave from './pages/Leave';
import Fairness from './pages/Fairness';
import Pay from './pages/Pay';
import OhConsole from './pages/OhConsole';
import Audit from './pages/Audit';
import Wellbeing from './pages/Wellbeing';
import Performance from './pages/Performance';
import Recruitment from './pages/Recruitment';
import Onboarding from './pages/Onboarding';
import Documents from './pages/Documents';
import Assistant from './pages/Assistant';
import AnalyticsPage from './pages/Analytics';
import Offboarding from './pages/Offboarding';
import Helpdesk from './pages/Helpdesk';
import Account from './pages/Account';
import Capacity from './pages/Capacity';

function Protected({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner className="h-6 w-6 text-ink-50" /></div>;
  if (!me) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/"                    element={<Protected><Dashboard /></Protected>} />
          <Route path="/schedule"            element={<Protected><MySchedule /></Protected>} />
          <Route path="/rosters"             element={<Protected><Rosters /></Protected>} />
          <Route path="/people"              element={<Protected><People /></Protected>} />
          <Route path="/people/:id"          element={<Protected><PersonDetail /></Protected>} />
          <Route path="/leave"               element={<Protected><Leave /></Protected>} />
          <Route path="/wellbeing"           element={<Protected><Wellbeing /></Protected>} />
          <Route path="/fairness"            element={<Protected><Fairness /></Protected>} />
          <Route path="/pay"                 element={<Protected><Pay /></Protected>} />
          <Route path="/occupational-health" element={<Protected><OhConsole /></Protected>} />
          <Route path="/audit"               element={<Protected><Audit /></Protected>} />
          <Route path="/performance"         element={<Protected><Performance /></Protected>} />
          <Route path="/recruitment"         element={<Protected><Recruitment /></Protected>} />
          <Route path="/onboarding"          element={<Protected><Onboarding /></Protected>} />
          <Route path="/documents"           element={<Protected><Documents /></Protected>} />
          <Route path="/assistant"           element={<Protected><Assistant /></Protected>} />
          <Route path="/analytics"           element={<Protected><AnalyticsPage /></Protected>} />
          <Route path="/offboarding"         element={<Protected><Offboarding /></Protected>} />
          <Route path="/helpdesk"            element={<Protected><Helpdesk /></Protected>} />
          <Route path="/account"             element={<Protected><Account /></Protected>} />
          <Route path="/capacity"            element={<Protected><Capacity /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
