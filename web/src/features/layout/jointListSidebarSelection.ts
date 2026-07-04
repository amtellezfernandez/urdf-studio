export const toggleStringSetValue = (previousValues: Set<string>, value: string): Set<string> => {
  const nextValues = new Set(previousValues);
  if (nextValues.has(value)) {
    nextValues.delete(value);
  } else {
    nextValues.add(value);
  }
  return nextValues;
};

export const toggleStringSetGroup = (
  previousValues: Set<string>,
  values: string[]
): Set<string> => {
  if (values.length === 0) {
    return previousValues;
  }

  const nextValues = new Set(previousValues);
  const areAllValuesSelected = values.every((value) => nextValues.has(value));

  values.forEach((value) => {
    if (areAllValuesSelected) {
      nextValues.delete(value);
    } else {
      nextValues.add(value);
    }
  });

  return nextValues;
};

export const filterStringSetMembers = (
  values: Set<string>,
  allowedValues: Set<string>
): Set<string> => {
  return new Set(Array.from(values).filter((value) => allowedValues.has(value)));
};

export const filterStringArrayMembers = (
  values: string[],
  allowedValues: Set<string>
): string[] => {
  return values.filter((value) => allowedValues.has(value));
};

export const countSelectedValues = (
  candidateValues: string[],
  selectedValues: Set<string>
): number => {
  return candidateValues.filter((value) => selectedValues.has(value)).length;
};

export const toggleSelectAllStringSetValues = (
  previousValues: Set<string>,
  values: string[],
  shouldDeselectAll: boolean
): Set<string> => {
  if (values.length === 0) {
    return previousValues;
  }

  const nextValues = new Set(previousValues);
  values.forEach((value) => {
    if (shouldDeselectAll) {
      nextValues.delete(value);
    } else {
      nextValues.add(value);
    }
  });
  return nextValues;
};
