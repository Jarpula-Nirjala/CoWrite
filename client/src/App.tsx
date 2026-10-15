import { useEffect } from 'react';
import { AuthProvider } from './auth.tsx';
import { Account } from './pages/Account.tsx';
import { Activity } from './pages/Activity.tsx';
import { AiTools } from './pages/AiTools.tsx';
import { Assistant } from './pages/Assistant.tsx';
import { Drive } from './pages/Drive.tsx';
import { Keep } from './pages/Keep.tsx';
import { Meet } from './pages/Meet.tsx';
import { Templates } from './pages/Templates.tsx';
import { ConnectionsPage } from './pages/ConnectionsPage.tsx';
import { Ask } from './pages/Ask.tsx';
import { CalendarPage } from './pages/Calendar.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { SitePage } from './pages/SitePage.tsx';
import { NewDoc } from './pages/NewDoc.tsx';
import { Workspaces } from './pages/Workspaces.tsx';
import { AuthPage, ForgotPage, ResetPage } from './pages/AuthPage.tsx';
import { DocPage } from './pages/DocPage.tsx';
import { Documents } from './pages/Documents.tsx';
import { Home } from './pages/Home.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { Profile } from './pages/Profile.tsx';
import { PublicDoc } from './pages/PublicPage.tsx';
import { usePath } from './router.ts';
import { AppRail, railHidden } from './components/AppRail.tsx';
import { WindowsProvider } from './components/Windows.tsx';

function Routes() {
  const path = usePath().replace(/\/+$/, '') || '/';

  useEffect(() => {
    if (path === '/') document.title = 'CoWrite: Real-Time Collaborative Editor';
  }, [path]);

  const doc = /^\/d\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (doc) return <DocPage key={doc[1]} roomId={doc[1]} />;
  const user = /^\/u\/([a-z0-9-]{1,40})$/.exec(path);
  if (user) return <Profile key={user[1]} username={user[1]} />;
  const nw = /^\/new\/([a-z]{2,10})$/.exec(path);
  if (nw) return <NewDoc key={nw[1]} kind={nw[1]} />;
  const site = /^\/site\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (site) return <SitePage key={site[1]} id={site[1]} />;
  const pub = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (pub) return <PublicDoc key={pub[1]} id={pub[1]} />;

  switch (path) {
    case '/':
      return <Home />;
    case '/signin':
      return <AuthPage mode="signin" />;
    case '/signup':
      return <AuthPage mode="signup" />;
    case '/forgot':
      return <ForgotPage />;
    case '/reset':
      return <ResetPage />;
    case '/documents':
      return <Documents />;
    case '/account':
      return <Account />;
    case '/activity':
      return <Activity />;
    case '/ask':
      return <Ask />;
    case '/home':
      return <Dashboard />;
    case '/calendar':
      return <CalendarPage />;
    case '/workspaces':
      return <Workspaces />;
    case '/templates':
      return <Templates />;
    case '/ai':
      return <AiTools />;
    case '/assistant':
      return <Assistant />;
    case '/keep':
      return <Keep />;
    case '/drive':
      return <Drive />;
    case '/meet':
      return <Meet />;
    case '/connections':
      return <ConnectionsPage />;
    default:
      return <NotFound />;
  }
}

function Rail() {
  const path = usePath().replace(/\/+$/, '') || '/';
  return railHidden(path) ? null : <AppRail />;
}

export function App() {
  return (
    <AuthProvider>
      <WindowsProvider>
        <Rail />
        <Routes />
      </WindowsProvider>
    </AuthProvider>
  );
}
