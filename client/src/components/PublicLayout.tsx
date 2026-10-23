import { Outlet } from 'react-router-dom';
import { PageFrame } from './PageFrame';

export default function PublicLayout() {
  return <PageFrame><Outlet /></PageFrame>;
}
