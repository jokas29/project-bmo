import type { MemoryRecord } from "./memory-store.ts";
import {
  MemoryServiceError,
  type MemoryService,
} from "./memory-service.ts";

export type ConfirmMemoryDeletion = (
  memory: MemoryRecord,
) => boolean | Promise<boolean>;

export interface MemoryUiController {
  isOpen(): boolean;
  destroy(): void;
}

interface MemoryUiOptions {
  service: MemoryService;
  openButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeButton: HTMLButtonElement;
  list: HTMLElement;
  empty: HTMLElement;
  feedback: HTMLElement;
  confirmation: HTMLElement;
  confirmationText: HTMLElement;
  confirmationCancelButton: HTMLButtonElement;
  confirmationDeleteButton: HTMLButtonElement;
  confirmDelete?: ConfirmMemoryDeletion;
}

type FeedbackKind = "status" | "error";

let memoryUiInstanceCount = 0;

function memoryPreview(memory: MemoryRecord): string {
  const normalizedText = memory.text.replace(/\s+/g, " ").trim();
  return (
    normalizedText.length > 140
      ? `${normalizedText.slice(0, 137)}…`
      : normalizedText
  );
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof MemoryServiceError) {
    return error.message;
  }

  return fallback;
}

export function createMemoryUi({
  service,
  openButton,
  dialog,
  closeButton,
  list,
  empty,
  feedback,
  confirmation,
  confirmationText,
  confirmationCancelButton,
  confirmationDeleteButton,
  confirmDelete,
}: MemoryUiOptions): MemoryUiController {
  const ownerDocument = list.ownerDocument;
  const descriptionPrefix = `memory-record-${++memoryUiInstanceCount}`;
  let currentMemories: readonly MemoryRecord[] = [];
  let deletingId: string | undefined;
  let renderRevision = 0;
  let destroyed = false;
  let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
  let unsubscribe = (): void => {};

  function settleConfirmation(confirmed: boolean): void {
    const resolve = resolveConfirmation;

    if (resolve === undefined) {
      return;
    }

    resolveConfirmation = undefined;
    confirmation.hidden = true;
    confirmationText.textContent = "";
    resolve(confirmed);
  }

  function showDeleteConfirmation(memory: MemoryRecord): Promise<boolean> {
    confirmationText.textContent =
      `¿Eliminar este recuerdo? Esta acción no se puede deshacer.\n\n` +
      memoryPreview(memory);
    confirmation.hidden = false;

    return new Promise((resolve) => {
      resolveConfirmation = resolve;
      confirmationCancelButton.focus();
    });
  }

  const requestDeleteConfirmation =
    confirmDelete ?? showDeleteConfirmation;

  function setFeedback(kind: FeedbackKind, message: string): void {
    feedback.dataset.kind = kind;
    feedback.setAttribute("role", kind === "error" ? "alert" : "status");
    feedback.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    feedback.textContent = message;
  }

  function setDeleteBusy(busy: boolean): void {
    list.setAttribute("aria-busy", String(busy));
    closeButton.disabled = busy;

    for (const button of list.querySelectorAll<HTMLButtonElement>(
      "button[data-memory-id]",
    )) {
      button.disabled = busy;
    }
  }

  function renderMemories(memories: readonly MemoryRecord[]): void {
    if (destroyed) {
      return;
    }

    currentMemories = [...memories];
    renderRevision += 1;

    const fragment = ownerDocument.createDocumentFragment();

    currentMemories.forEach((memory, index) => {
      const item = ownerDocument.createElement("li");
      const text = ownerDocument.createElement("span");
      const deleteButton = ownerDocument.createElement("button");

      item.className = "memory-item";

      text.className = "memory-item-text";
      text.id = `${descriptionPrefix}-${renderRevision}-${index}`;
      text.textContent = memory.text;

      deleteButton.className = "memory-delete";
      deleteButton.type = "button";
      deleteButton.dataset.memoryId = memory.id;
      deleteButton.disabled = deletingId !== undefined;
      deleteButton.setAttribute("aria-describedby", text.id);
      deleteButton.textContent = "Eliminar";

      item.append(text, deleteButton);
      fragment.append(item);
    });

    list.replaceChildren(fragment);
    list.setAttribute("aria-busy", String(deletingId !== undefined));
    empty.hidden = currentMemories.length > 0;
  }

  async function removeMemory(memory: MemoryRecord): Promise<void> {
    if (destroyed || deletingId !== undefined) {
      return;
    }

    deletingId = memory.id;
    const removedIndex = currentMemories.findIndex(
      (candidate) => candidate.id === memory.id,
    );
    let focusAfterDelete: HTMLButtonElement | undefined;
    setDeleteBusy(true);

    try {
      const confirmed = await requestDeleteConfirmation(memory);

      if (destroyed || deletingId !== memory.id || !confirmed) {
        return;
      }

      setFeedback("status", "Eliminando recuerdo…");
      const removed = await service.removeMemory(memory.id);

      if (destroyed || deletingId !== memory.id) {
        return;
      }

      renderMemories(service.getMemories());
      setFeedback(
        "status",
        removed
          ? "Recuerdo eliminado."
          : "Ese recuerdo ya no estaba guardado.",
      );

      if (removed && dialog.open) {
        const remainingButtons = list.querySelectorAll<HTMLButtonElement>(
          "button[data-memory-id]",
        );
        const nextButton =
          remainingButtons[Math.min(removedIndex, remainingButtons.length - 1)];

        focusAfterDelete = nextButton ?? closeButton;
      }
    } catch (error) {
      if (!destroyed && deletingId === memory.id) {
        setFeedback(
          "error",
          friendlyError(
            error,
            "No pude eliminar ese recuerdo. Inténtalo de nuevo.",
          ),
        );
      }
    } finally {
      if (deletingId === memory.id) {
        deletingId = undefined;

        if (!destroyed) {
          if (focusAfterDelete === undefined && dialog.open) {
            focusAfterDelete = Array.from(
              list.querySelectorAll<HTMLButtonElement>(
                "button[data-memory-id]",
              ),
            ).find((button) => button.dataset.memoryId === memory.id);
          }

          setDeleteBusy(false);
          focusAfterDelete?.focus();
        }
      }
    }
  }

  function handleOpen(): void {
    if (destroyed || dialog.open) {
      return;
    }

    try {
      dialog.showModal();
      openButton.setAttribute("aria-expanded", "true");
      closeButton.focus();
    } catch (error) {
      setFeedback(
        "error",
        friendlyError(error, "No pude abrir la memoria. Inténtalo de nuevo."),
      );
    }
  }

  function handleClose(): void {
    if (!destroyed && dialog.open) {
      dialog.close();
    }
  }

  function handleDialogClosed(): void {
    openButton.setAttribute("aria-expanded", "false");
  }

  function handleDialogCancel(event: Event): void {
    if (resolveConfirmation !== undefined) {
      event.preventDefault();
      settleConfirmation(false);
      return;
    }

    if (deletingId !== undefined) {
      event.preventDefault();
    }
  }

  function handleConfirmationCancel(): void {
    settleConfirmation(false);
  }

  function handleConfirmationDelete(): void {
    settleConfirmation(true);
  }

  function handleListClick(event: MouseEvent): void {
    const target = event.target;

    if (
      target === null ||
      typeof (target as Element).closest !== "function"
    ) {
      return;
    }

    const deleteButton = (target as Element).closest<HTMLButtonElement>(
      "button[data-memory-id]",
    );

    if (deleteButton === null || !list.contains(deleteButton)) {
      return;
    }

    const memoryId = deleteButton.dataset.memoryId;
    const memory = currentMemories.find((candidate) => candidate.id === memoryId);

    if (memory === undefined) {
      setFeedback("status", "Ese recuerdo ya no está disponible.");
      return;
    }

    void removeMemory(memory);
  }

  openButton.addEventListener("click", handleOpen);
  closeButton.addEventListener("click", handleClose);
  dialog.addEventListener("close", handleDialogClosed);
  dialog.addEventListener("cancel", handleDialogCancel);
  list.addEventListener("click", handleListClick);
  confirmationCancelButton.addEventListener(
    "click",
    handleConfirmationCancel,
  );
  confirmationDeleteButton.addEventListener(
    "click",
    handleConfirmationDelete,
  );
  openButton.setAttribute("aria-expanded", String(dialog.open));

  try {
    renderMemories(service.getMemories());
    unsubscribe = service.subscribe(renderMemories);
  } catch (error) {
    renderMemories([]);
    setFeedback(
      "error",
      friendlyError(
        error,
        "No pude mostrar los recuerdos guardados. Inténtalo de nuevo.",
      ),
    );
  }

  function isOpen(): boolean {
    return dialog.open;
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    destroyed = true;
    settleConfirmation(false);
    unsubscribe();
    openButton.removeEventListener("click", handleOpen);
    closeButton.removeEventListener("click", handleClose);
    dialog.removeEventListener("close", handleDialogClosed);
    dialog.removeEventListener("cancel", handleDialogCancel);
    list.removeEventListener("click", handleListClick);
    confirmationCancelButton.removeEventListener(
      "click",
      handleConfirmationCancel,
    );
    confirmationDeleteButton.removeEventListener(
      "click",
      handleConfirmationDelete,
    );

    if (dialog.open) {
      dialog.close();
    }

    openButton.setAttribute("aria-expanded", "false");
  }

  return {
    isOpen,
    destroy,
  };
}
