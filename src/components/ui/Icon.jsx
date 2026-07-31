export function Icon({ name, size, className, ...rest }) {
  const sizeClass = size ? ` ic-${size}` : '';
  return (
    <svg className={`ic${sizeClass}${className ? ` ${className}` : ''}`} aria-hidden="true" {...rest}>
      <use href={`#i-${name}`} />
    </svg>
  );
}
