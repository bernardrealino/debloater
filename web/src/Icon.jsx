import React from 'react';

/**
 * Phosphor icon (bundled from @phosphor-icons/web). `name` is the icon name without the
 * "ph-" prefix, e.g. "house". `fill` uses the filled weight. Icons are decorative; give the
 * surrounding button a text label or aria-label.
 */
export default function Icon({ name, fill = false, size, className = '' }) {
  return <i className={`${fill ? 'ph-fill' : 'ph'} ph-${name} icon ${className}`} style={size ? { fontSize: size } : undefined} aria-hidden="true" />;
}
