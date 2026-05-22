# *broken💎shaders' `SKILL.md` files*

I created these. Use them as you please.

Using Claude Code plugin manager:
```bash
/plugin marketplace add shdrs/skills
/plugin install cytospec@shdrs

# or from the outside:
claude plugin marketplace add shdrs/skills
claude plugin install cytospec@shdrs
```

## `/cytospec`

**Turn `n` specs into a decision-graph**

- Perfect as an addon to `/using-superpowers` spec files
- *Maps ALL decision points across ALL spec files you give it...*
- Intended for complex projects with many interconnected decision points spread across many spec files
- **⚠️ Warning:** the more inputs you give it, the longer it will have to run for. This example of a total of around 70k tokens worth of spec (~5k LOC) took opus-4.6 **1 hour to generate**. This is the feature though: the pipeline actually does deep analysis and attempts comparing every single decision in the specs against each other [(full docs)](/docs/cytospec.md).

<img src=".github/assets/demos/cytospec.gif" alt="cytospec demo" width="800" />

## `/mega-skill`

Develop skills in the same style as this repo demonstrates.
- Turn skill suites into a single mega-skill that invokes sub-skills under the hood
- Agent-agnostic publishing to github

Use this together with a skill-creator plugin, such as the official one from anthropic.

## `/watch-video`

Coming soon. Video to textual context with Claude Code.

---

### Development

Build all skills for all agent-providers in this repo:

```bash
bun run build
```
