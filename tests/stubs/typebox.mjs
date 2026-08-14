const schema = (type, value = {}) => ({ type, ...value });

export const Type = {
  Array: (items, options = {}) => schema('array', { items, ...options }),
  Boolean: (options = {}) => schema('boolean', options),
  Literal: (value) => ({ const: value }),
  Number: (options = {}) => schema('number', options),
  Object: (properties, options = {}) => schema('object', { properties, ...options }),
  Optional: (value) => value,
  String: (options = {}) => schema('string', options),
  Union: (anyOf, options = {}) => ({ anyOf, ...options }),
};
