# Changelog

## [0.8.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.7.0...mdpm-v0.8.0) (2026-10-02)


### Features

* **cli:** add mdpm tui, an interactive kanban board for the terminal ([0d32c21](https://github.com/cwilsonn/mdpm/commit/0d32c21bece90b7a42cb5b26fe59f91d9cd91f7d))


### Bug Fixes

* **cli:** fit the tui layout and key hints to the terminal size ([8bef654](https://github.com/cwilsonn/mdpm/commit/8bef654a47be8d5f3333a6187cfa0b0fc36dbc8b))

## [0.7.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.6.0...mdpm-v0.7.0) (2026-10-01)


### Features

* **cli:** add mdpm watch to follow content changes live ([c9cc7c0](https://github.com/cwilsonn/mdpm/commit/c9cc7c00de60d1da89b8c8c8ec898009dcffc6e8))

## [0.6.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.5.0...mdpm-v0.6.0) (2026-10-01)


### Features

* **cli:** add --where bulk selection to task set, done, archive, unarchive, and delete ([ad03b95](https://github.com/cwilsonn/mdpm/commit/ad03b95a903084c2d702b09aed4ce9534894ec6e))
* **cli:** add doc create, edit, archive, unarchive, and delete commands ([b6dcacb](https://github.com/cwilsonn/mdpm/commit/b6dcacbb9f4637f1b22188b0d176b7e9f492dd62))
* **cli:** add export and import for JSON, CSV, and markdown ([c10784a](https://github.com/cwilsonn/mdpm/commit/c10784a77f77019813dd835bc019cb9ab3f6bbd5))
* **cli:** add mdpm log and author-stamped task notes ([c023a95](https://github.com/cwilsonn/mdpm/commit/c023a955c09e712a193d75f27dbc258460ddf4b2))
* **cli:** add shell completions for zsh, bash, and fish ([959bef6](https://github.com/cwilsonn/mdpm/commit/959bef6f6c5a12d5b0249c818bcc44d40be8b26d))
* **cli:** add task ready and graph for dependency views ([efd7264](https://github.com/cwilsonn/mdpm/commit/efd7264a694df9d73d727914c4abb44fd2cc92cd))
* **mcp:** add project update/archive/delete and task/doc archive tools ([0b08df8](https://github.com/cwilsonn/mdpm/commit/0b08df8ed891c71dc9b84a54c1a64a468182bef5))

## [0.5.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.4.0...mdpm-v0.5.0) (2026-10-01)


### Features

* **cli:** bind the dev server to the base URL's host so localhost works without admin rights ([2eb666d](https://github.com/cwilsonn/mdpm/commit/2eb666d107babaaedcb845aa12fa4eb039bc2a2d))


### Bug Fixes

* **mcp:** report the package version instead of a hardcoded 1.0.0 ([9db4d80](https://github.com/cwilsonn/mdpm/commit/9db4d8011e8040d78950f3a7a3e53273f9bfa59f))

## [0.4.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.3.1...mdpm-v0.4.0) (2026-10-01)


### Features

* **cli:** add mdpm init to register a repo with mdpm ([849bd0e](https://github.com/cwilsonn/mdpm/commit/849bd0ed5de6a0af441a1cca49711b6e444e4c1a))
* **cli:** add skills install, uninstall, and status commands ([bc4fc9e](https://github.com/cwilsonn/mdpm/commit/bc4fc9e36db34c8aeed400f66a5f5375f6e5c4df))
* **cli:** add warn-only audit-trail hooks for Claude Code ([99e8119](https://github.com/cwilsonn/mdpm/commit/99e8119d7743d7afea2ab29a1d25cb32ade3ce68))


### Bug Fixes

* **core:** infer projects from non-GitHub git remotes ([969ad85](https://github.com/cwilsonn/mdpm/commit/969ad85a77bbae0e44bdf3f8da5d5a8eeaf1beb4))

## [0.3.1](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.3.0...mdpm-v0.3.1) (2026-10-01)


### Bug Fixes

* **core:** share one content root between the web app and the CLI ([4777c5f](https://github.com/cwilsonn/mdpm/commit/4777c5f6a424558502be93640c202149677fa621))

## [0.3.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.2.1...mdpm-v0.3.0) (2026-09-30)


### Features

* **cli:** add --auto-start for write commands ([fababae](https://github.com/cwilsonn/mdpm/commit/fababaeb732a85d623a25dc703ad36bf49e43c70))
* **cli:** add pickup command ([1618111](https://github.com/cwilsonn/mdpm/commit/16181117b93be610b36d339c052e0a8d4a7f4e77))
* **cli:** add project and doc commands ([0432f06](https://github.com/cwilsonn/mdpm/commit/0432f063d0086adc9235a40c4bcd0075de6c7bcc))
* **cli:** add start/stop/restart/status lifecycle commands ([1a25ea4](https://github.com/cwilsonn/mdpm/commit/1a25ea4fe09e20ab8af270231ae3778bff84e8c3))
* **cli:** add task list/show/add/set/done/note/archive/delete commands ([9a6e080](https://github.com/cwilsonn/mdpm/commit/9a6e080e834526060bea3dba9a33d43cea4528f4))
* **cli:** resolve config from flags, env, and ~/.config/mdpm ([5ef344d](https://github.com/cwilsonn/mdpm/commit/5ef344d4360c690c387adb4814ec3117bebfa8e3))


### Bug Fixes

* **core:** normalize unquoted YAML dates from hand-edited files ([f2dc530](https://github.com/cwilsonn/mdpm/commit/f2dc530d93be8082798b2169dd7a18dc58a8a7e3))


### Refactoring

* **skills:** run /pickup through mdpm pickup ([de78961](https://github.com/cwilsonn/mdpm/commit/de78961f9a26bae6d6a8ab514649a972e8261467))
* **skills:** run start/stop/sync/handoff through the mdpm CLI ([79747fd](https://github.com/cwilsonn/mdpm/commit/79747fd8aeaebd0ff2868d6e4d392a0f36bf211c))

## [0.2.1](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.2.0...mdpm-v0.2.1) (2026-09-30)


### Bug Fixes

* **skills:** stop-mdpm kills every PID on the port ([02bbf17](https://github.com/cwilsonn/mdpm/commit/02bbf17becab4c453f34caeccfbc54637a3bba68))

## [0.2.0](https://github.com/cwilsonn/mdpm/compare/mdpm-v0.1.0...mdpm-v0.2.0) (2026-09-30)


### Features

* **cli:** add CLI skeleton with ping command ([7fd8d90](https://github.com/cwilsonn/mdpm/commit/7fd8d90ad73aae0657cb24d6a004d20d2678115c))
