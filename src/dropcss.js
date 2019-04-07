const { parse: parseHTML } = require('./html');
const { parse: parseCSS, generate: generateCSS, SELECTORS, takeUntilMatchedClosing } = require('./css');
const { some } = require('./sel');
const matches = require('./matches');

const ATTRIBUTES = /\[([\w-]+)(?:(.?=)"?([^\]]*?)"?)?\]/i;

const pseudoAssertable = /:(?:first|last|nth|only|not|empty)\b/;		// |lang

function stripNonAssertablePseudos(sel) {
	// strip pseudo-elements and transient pseudo-classes
	return sel.replace(/:?:[a-z-]+/gm, (m) =>
		sel.startsWith('::') || !pseudoAssertable.test(m) ? '' : m
	)
	// remove any empty leftovers eg :not() - [tabindex="-1"]:focus:not(:focus-visible)
	.replace(/:[a-z-]+\(\)/gm, '');
}

function splice(str, index, count, add) {
	return str.slice(0, index) + add + str.slice(index + count);
}

function dropKeyFrames(css) {
	let matches = [];
	let used = new Set();

	// defined
	let RE = /@(?:-\w+-)?keyframes\s+([\w-]+)\s*\{/gm, m;

	while (m = RE.exec(css)) {
		let ch = takeUntilMatchedClosing(css, RE.lastIndex);
		matches.push([m.index, m[0].length + ch.length + 1, m[1]]);
	}

	// used
	let RE2 = /animation(?:-name)?:([^;!}]+)/gm;

	while (m = RE2.exec(css)) {
		m[1].trim().split(",").forEach(a => {
			used.add(a.trim().match(/^[\w-]+/)[0]);
		});
	}

	// purge backwards
	let css2 = css;
	for (let i = matches.length - 1; i > -1; i--) {
		let ma = matches[i];

		if (!used.has(ma[2]))
			css2 = splice(css2, ma[0], ma[1], '');
	}

	return css2;
}

function dropFontFaces(css) {

}

const drop = sel => false;

function dropcss(opts) {
	let START = +new Date();

	let log = [[0, 'Start']];

	// {nodes, tag, class, id}
	const H = parseHTML(opts.html, !opts.keepText);

	log.push([+new Date() - START, 'HTML parsed & processed']);

	const shouldKeep = opts.shouldKeep || drop;

	let tokens = parseCSS(opts.css);

	log.push([+new Date() - START, 'CSS tokenized']);

	// cache
	let tested = {};

	// null out tokens that have any unmatched sub-selectors in flat dom
	for (let i = 0; i < tokens.length; i++) {
		let token = tokens[i];

		if (token !== SELECTORS)
			continue;

		let sels = tokens[i+1];
		let sels2 = sels[sels.length - 1];

		i++;

		for (let j = 0; j < sels2.length; j++) {
			let subs = sels2[j];

			subsLoop:
			for (let k = 0; k < subs.length; k++) {
				let sub = subs[k];
				let hasOne = false;
				let name;

				if (sub == '')
					continue;

				// cache
				if (sub in tested)
					hasOne = tested[sub];
				else {
					// hehe Sub-Zero :D
					switch (sub[0]) {
						case "#":
							name = sub.substr(1);
							tested[sub] = hasOne = H.attr.has('[id=' + name + ']');
							break;
						case ".":
							name = sub.substr(1);
							tested[sub] = hasOne = H.class.has(name);
							break;
						case "[":
							// [type=...] is super common in css, so it gets special fast-path treatment, which is a large perf win
							if (sub.startsWith('[type='))
								tested[sub] = hasOne = H.attr.has(sub);
							else {
								let m = sub.match(ATTRIBUTES);
								tested[sub] = hasOne = H.nodes.some(el => matches.attr(el, m[1], m[3], m[2]));
							}
							break;
						default:
							tested[sub] = hasOne = H.tag.has(sub);
					}
				}

				if (!hasOne) {
					if (shouldKeep(sels[j]) !== true)
						sels[j] = null;
					else
						tested[sels[j]] = true;			// should this be pseudo-stripped?

					break subsLoop;
				}
			}
		}
	}

	log.push([+new Date() - START, 'Context-free first pass']);

	for (let i = 0; i < tokens.length; i++) {
		let tok = tokens[i];

		if (tok === SELECTORS) {
			i++;
			let len = tokens[i].length;
			tokens[i] = tokens[i].filter(s => {
				if (typeof s == 'string') {
					if (s in tested)
						return tested[s];

					let cleaned = stripNonAssertablePseudos(s);

					if (cleaned == '')
						return true;

					if (cleaned in tested)
						return tested[cleaned];

					return tested[cleaned] = (some(H.nodes, cleaned) || shouldKeep(s) === true);
				}

				return false;
			});
		}
	}

	log.push([+new Date() - START, 'Context-aware second pass']);

	let out = generateCSS(tokens);

	log.push([+new Date() - START, 'Generate output']);

	out = dropKeyFrames(out);

	log.push([+new Date() - START, 'Drop keyframes']);

//	log.forEach(e => console.log(e[0], e[1]));

	return {
		css: out
	};
}

module.exports = dropcss;