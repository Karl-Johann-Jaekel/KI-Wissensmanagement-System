"""Unit tests for the rule-based dependency/topic -> graph mapping (no DB).

Covers PLAN §7 Phase 1 DoD: "Unit-Tests fürs Dependency-Mapping."
"""

from __future__ import annotations

from app.github.extract import (
    canonical_tech,
    extract_dependencies,
    parse_package_json,
    parse_pyproject,
    parse_requirements,
)


def test_canonical_tech_known_alias() -> None:
    assert canonical_tech("react-dom") == "React"
    assert canonical_tech("SQLAlchemy") == "SQLAlchemy"
    assert canonical_tech("psycopg2-binary") == "psycopg"


def test_canonical_tech_unknown_lowercased() -> None:
    assert canonical_tech("SomeObscureLib") == "someobscurelib"


def test_parse_package_json() -> None:
    text = """
    {
      "name": "demo",
      "dependencies": {"react": "^18.0.0", "react-dom": "^18.0.0"},
      "devDependencies": {"vite": "^5.0.0", "typescript": "^5.0.0"}
    }
    """
    assert parse_package_json(text) == {"react", "react-dom", "vite", "typescript"}


def test_parse_package_json_invalid() -> None:
    assert parse_package_json("not json {") == set()


def test_parse_pyproject_pep621_and_optional() -> None:
    text = """
    [project]
    name = "x"
    dependencies = ["fastapi>=0.115", "sqlalchemy>=2.0", "httpx>=0.27; python_version>='3.10'"]
    [project.optional-dependencies]
    dev = ["pytest>=8.0", "ruff"]
    """
    assert parse_pyproject(text) == {"fastapi", "sqlalchemy", "httpx", "pytest", "ruff"}


def test_parse_pyproject_poetry_skips_python() -> None:
    text = """
    [tool.poetry.dependencies]
    python = "^3.12"
    flask = "^3.0"
    requests = "^2.31"
    """
    assert parse_pyproject(text) == {"flask", "requests"}


def test_parse_requirements_strips_specifiers_and_comments() -> None:
    text = "numpy==1.26.0\npandas>=2.0  # data\n# a comment\n-r other.txt\ntorch"
    assert parse_requirements(text) == {"numpy", "pandas", "torch"}


def test_extract_dependencies_canonicalizes_and_merges() -> None:
    manifests = {
        "package.json": '{"dependencies": {"react": "^18"}}',
        "requirements.txt": "torch\nsqlalchemy>=2.0",
    }
    assert extract_dependencies(manifests) == {"React", "PyTorch", "SQLAlchemy"}
