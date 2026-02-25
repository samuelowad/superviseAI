import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

interface NavigateOptions {
  replace?: boolean;
}

interface RouterContextValue {
  path: string;
  search: string;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function normalizePath(input: string): string {
  const url = new URL(input, window.location.origin);
  return `${url.pathname}${url.search}`;
}

export function RouterProvider({ children }: PropsWithChildren): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const onPopState = (): void => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (to: string, options?: NavigateOptions): void => {
    const target = normalizePath(to);

    if (options?.replace) {
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
    }

    setPath(window.location.pathname);
    setSearch(window.location.search);
  };

  const value = useMemo<RouterContextValue>(() => ({ path, search, navigate }), [path, search]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

function shouldHandleClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !(event.defaultPrevented || event.button !== 0 || isModifiedEvent(event));
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used inside RouterProvider.');
  }

  return context;
}

export function useNavigate(): RouterContextValue['navigate'] {
  const { navigate } = useRouter();
  return navigate;
}

export function useSearchParams(): [URLSearchParams] {
  const { search } = useRouter();
  return [new URLSearchParams(search)];
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children: ReactNode;
}

export function Link({ to, onClick, children, ...props }: LinkProps): JSX.Element {
  const { navigate } = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);

    if (!shouldHandleClick(event)) {
      return;
    }

    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

interface NavLinkProps extends Omit<LinkProps, 'className'> {
  className?: string | ((params: { isActive: boolean }) => string);
  end?: boolean;
}

function isLinkActive(currentPath: string, targetPath: string, end: boolean): boolean {
  if (end) {
    return currentPath === targetPath;
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

export function NavLink({
  className,
  end = false,
  to,
  children,
  ...props
}: NavLinkProps): JSX.Element {
  const { path } = useRouter();
  const active = isLinkActive(path, to, end);
  const computedClassName =
    typeof className === 'function' ? className({ isActive: active }) : (className ?? '');

  return (
    <Link to={to} className={computedClassName} {...props}>
      {children}
    </Link>
  );
}
