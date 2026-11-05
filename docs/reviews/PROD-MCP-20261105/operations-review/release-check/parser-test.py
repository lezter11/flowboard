import ast,json,pathlib
p=pathlib.Path('docs/reviews/PROD-MCP-20261105/monitor-production.py')
module=ast.parse(p.read_text()); functions=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in ['accept','parse']]
report={'events':0,'scheduledEvents':0,'scheduledOk':0,'exceptionCount':0,'errorLogCount':0,'http5xx':0,'outcomes':{},'httpStatuses':{},'parserOverflows':0}
ns={'report':report,'buf':'','decoder':json.JSONDecoder(),'json':json}
exec(compile(ast.Module(body=functions,type_ignores=[]),str(p),'exec'),ns)
secret='SYNTHETIC_PRIVATE_NOT_TO_PERSIST'
events=[{'scriptName':'flowboard-api','outcome':'ok','exceptions':[],'logs':[{'level':'log','message':[secret]}],'event':{'cron':'* * * * *','request':{'url':'https://example.invalid/'+secret,'headers':{'Authorization':secret}}}}, {'scriptName':'flowboard-api','outcome':'exception','exceptions':[{'message':secret}],'logs':[{'level':'error','message':[secret]}],'event':{'response':{'status':503}}}, {'scriptName':'other-worker','outcome':'ok','exceptions':[],'event':{}}, {'scriptName':'flowboard-api','outcome':secret,'exceptions':[],'logs':[],'event':{'response':{'status':200}}}]
wire=('startup text\n'+''.join(json.dumps(x,indent=2) for x in events)).encode()
for i in range(0,len(wire),17):ns['parse'](wire[i:i+17])
assert report['events']==3 and report['scheduledOk']==1 and report['exceptionCount']==1 and report['errorLogCount']==1 and report['http5xx']==1
assert report['outcomes']=={'ok':1,'exception':1,'other':1}
assert secret not in json.dumps(report)
ns['parse'](b'{'+b'x'*(2*1024*1024+1));assert report['parserOverflows']==1 and ns['buf']==''
print(json.dumps({'status':'pass','fragmentedConcatenatedEvents':True,'privateStringsDiscarded':True,'foreignScriptIgnored':True,'unknownOutcomeMappedToFixedOther':True,'exceptionsErrors503Counted':True,'overflowBound':True,'liveCalls':0},indent=2))
