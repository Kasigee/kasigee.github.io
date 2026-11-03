"""Build traces.json for the trace explorer from the study's raw result files.

usage: python3 make_traces.py <package data folder> ../traces.json

Keeps, for every task and model, the verbatim output and the per-task numbers the harness recorded.
Local file paths in the source files are dropped. Adds two checks of our own:
  strict: the harness's pass, and for the boxed-answer graders also a \\boxed{} after </think>
          (the harness falls back to a box at the end of the <think> block when there is none);
  cjk:    whether the reasoning or the final answer contains Chinese characters."""
import json, os, re, sys

CJK = re.compile(r'[\u4e00-\u9fff]')

MODELS = [('0.6B', 'Qwen3-0.6B_before_results.json'), ('0.6B-WSP', 'Qwen3-0.6B-WSP_after_results.json'),
          ('1.7B', 'Qwen3-1.7B_before_results.json'), ('1.7B-WSP', 'Qwen3-1.7B-WSP_after_results.json')]
B = lambda v: v in (True, 'True', 'true')

def main(src, out):
    suite = {t['id']: t for t in json.load(open(os.path.join(src, 'multi_domain_test_suite.json')))}
    tasks = {tid: {'id': tid, 'domain': t['domain'], 'title': t['title'], 'prompt': t['prompt'],
                   'grader': t['grader_type'], 'expected': t.get('expected'), 'runs': {}} for tid, t in suite.items()}
    for label, f in MODELS:
        for i in json.load(open(os.path.join(src, f)))['items']:
            text = i['raw_output']
            think, _, answer = text.partition('</think>')
            boxed = tasks[i['id']]['grader'].startswith('boxed')
            strict = B(i['strict_correct']) and (not boxed or bool(re.search(r'\\boxed\{', answer)))
            tasks[i['id']]['runs'][label] = {
                'strict': strict, 'cjk_think': bool(CJK.search(think)), 'cjk_answer': bool(CJK.search(answer)),
                'pass': B(i['strict_correct']), 'closed': B(i['closed_think']), 'cutoff': B(i['hit_cutoff']),
                'tokens': int(i['total_tokens']), 'think': int(i['think_tokens']), 'answer': int(i['answer_tokens']),
                'waits': int(i['wait_check_count']), 'est_s': round(float(i['effective_single_stream_est_seconds']), 1),
                'grade': i['grade_reason'], 'output': i['raw_output'],
            }
    json.dump({'budget': 1024, 'tasks': list(tasks.values())}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(len(tasks), 'tasks written')

if __name__ == '__main__':
    main(*sys.argv[1:])
