from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class JsonRepository:
    def __init__(self, db_dir: Path) -> None:
        self.db_dir = db_dir

    def read_list(self, file_name: str, model_cls: type[T]) -> list[T]:
        path = self.db_dir / file_name
        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
        return [model_cls.model_validate(item) for item in raw]

    def write_list(self, file_name: str, values: list[BaseModel | dict[str, Any]]) -> None:
        path = self.db_dir / file_name
        payload: list[dict[str, Any]] = []

        for value in values:
            if isinstance(value, BaseModel):
                payload.append(value.model_dump(mode="json"))
            else:
                payload.append(value)

        temp_path = path.with_suffix(f"{path.suffix}.tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")

        temp_path.replace(path)
