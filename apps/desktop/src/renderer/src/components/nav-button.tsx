import type { ReactElement } from 'react';

type NavButtonProps = {
  active: boolean;
  badge?: string;
  collapsed: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
};

export function NavButton({ active, badge, collapsed, icon, label, onClick }: NavButtonProps): ReactElement {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} type="button" title={collapsed ? label : undefined}>
      {icon}
      <span>{label}</span>
      {badge ? <small>{badge}</small> : null}
    </button>
  );
}
