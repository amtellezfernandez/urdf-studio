/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  readStructureDropGroupLabel,
  resolveStructureDropGroupLabelFromPoint,
  STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE,
} from "@/features/layout/structureDragDrop";

const TEST_POINT_X = 20;
const TEST_POINT_Y = 24;
const POINT_STACK_EMPTY: Element[] = [];
const NO_POINT_ELEMENT = () => null;

const createDropContainer = () => {
  const container = document.createElement("div");
  const section = document.createElement("section");
  section.setAttribute(STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE, "arm2");
  const row = document.createElement("div");
  row.textContent = "row";
  section.appendChild(row);
  container.appendChild(section);
  document.body.appendChild(container);
  return { container, section, row };
};

const setDocumentPointResolvers = ({
  elementsFromPoint,
  elementFromPoint,
}: {
  elementsFromPoint?: ((x: number, y: number) => Element[]) | undefined;
  elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
}) => {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: elementsFromPoint,
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: elementFromPoint ?? NO_POINT_ELEMENT,
  });
};

describe("structureDragDrop", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setDocumentPointResolvers({
      elementsFromPoint: undefined,
      elementFromPoint: NO_POINT_ELEMENT,
    });
  });

  it("reads and normalizes a drop-group label from an element", () => {
    const section = document.createElement("section");
    section.setAttribute(STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE, "  wheel1  ");

    expect(readStructureDropGroupLabel(section)).toBe("wheel1");
  });

  it("resolves the drop-group label from the top candidate element", () => {
    const { container, row } = createDropContainer();
    setDocumentPointResolvers({
      elementsFromPoint: () => [row],
    });

    const resolved = resolveStructureDropGroupLabelFromPoint({
      container,
      clientX: TEST_POINT_X,
      clientY: TEST_POINT_Y,
    });

    expect(resolved).toBe("arm2");
  });

  it("skips overlay elements and resolves from lower candidates", () => {
    const { container, row } = createDropContainer();
    const overlay = document.createElement("div");
    setDocumentPointResolvers({
      elementsFromPoint: () => [overlay, row],
    });

    const resolved = resolveStructureDropGroupLabelFromPoint({
      container,
      clientX: TEST_POINT_X,
      clientY: TEST_POINT_Y,
    });

    expect(resolved).toBe("arm2");
  });

  it("ignores drop-group elements outside the current container", () => {
    const { container } = createDropContainer();
    const externalSection = document.createElement("section");
    externalSection.setAttribute(STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE, "base");
    document.body.appendChild(externalSection);
    setDocumentPointResolvers({
      elementsFromPoint: () => [externalSection],
    });

    const resolved = resolveStructureDropGroupLabelFromPoint({
      container,
      clientX: TEST_POINT_X,
      clientY: TEST_POINT_Y,
    });

    expect(resolved).toBeNull();
  });

  it("falls back to elementFromPoint when elementsFromPoint returns no candidates", () => {
    const { container, row } = createDropContainer();
    setDocumentPointResolvers({
      elementsFromPoint: () => POINT_STACK_EMPTY,
      elementFromPoint: () => row,
    });

    const resolved = resolveStructureDropGroupLabelFromPoint({
      container,
      clientX: TEST_POINT_X,
      clientY: TEST_POINT_Y,
    });

    expect(resolved).toBe("arm2");
  });
});
