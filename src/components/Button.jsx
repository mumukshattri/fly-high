import Icon from './Icon';

/**
 * components/Button.jsx
 * ---------------------------------------------------------------------------
 * One button component for the whole app so every screen looks the same and
 * the loading state is handled in a single place.
 *
 * <Button variant="primary" icon="plus" onClick={save} loading={saving}>
 *   Create Drive
 * </Button>
 *
 * variant: 'primary' | 'outline' | 'ghost' | 'success' | 'danger' |
 *          'danger-outline' | 'applied'
 * size:    'sm' | 'md' | 'lg'
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  fullWidth = false,
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    fullWidth ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? (
        <span className="btn__spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
      {!loading && iconRight ? <Icon name={iconRight} size={size === 'sm' ? 14 : 16} /> : null}
    </button>
  );
}
