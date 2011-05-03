// exports
exports.QueryPlan = {};
var QueryPlan = exports.QueryPlan;

// imports
var Utils = require("./../../js-trees/src/utils").Utils;

QueryPlan.orderJoins = function(bgps) {
    // @todo order joins somehow
    return bgps;
};


QueryPlan.variablesInBGP = function(bgp) {
    // may be cached in the pattern
    var variables = bgp.variables;
    if(variables) {
        return variables;
    }

    var components =  bgp.value || bgp;
    var variables  = [];
    for(comp in components) {
        if(components[comp] && components[comp].token === "var") {
            variables.push(components[comp].value);
        }
    }
    bgp.variables = variables;

    return variables;
};

QueryPlan.variablesIntersectionBGP = function(bgpa, bgpb) {
    var varsa = QueryPlan.variablesInBGP(bgpa).sort();
    var varsb = QueryPlan.variablesInBGP(bgpb).sort();

    var ia = 0;
    var ib = 0;

    var intersection = [];

    while(ia<varsa.length && ib<varsb.length) {
        if(varsa[ia] === varsb[ib]) {
            intersection.push(varsa[ia]);
            ia++;
            ib++;
        } else if(varsa[ia] < varsb[ib]) {
            ia++;
        } else {
            ib++;
        }
    }

    return intersection;
};

QueryPlan.executeAndBGPs = function(bgps, dataset, queryEngine, env, callback) {
    for(var i=0; i<bgps.length; i++) {
        bgps[i].graph = dataset;
    }

    var pairs = Utils.partition(bgps,2);

    QueryPlan.buildBushyJoinTreeBase(pairs, queryEngine, env, function(success, results){
        if(success) {
            callback(true, results);
        } else {
            callback(false, results);
        }
    });
};

QueryPlan.buildBushyJoinTreeBase = function(pairs, queryEngine, queryEnv, callback) {
    var that = this;
    Utils.repeat(0, pairs.length, function(k, env) {
        var floop = arguments.callee;
        var pair = pairs[env._i];
        var bgpa = pair[0];
        var bgpb = pair[1];

        QueryPlan.executeAndBGP(bgpa,bgpb, queryEngine, queryEnv, function(success, results){
            if(success) {
                if(env.acum == null) {
                    env.acum = [];
                }
                env.acum.push(results);

                k(floop, env);
            } else {
                callback(success,results);
            }
        });
    }, function(env){
        QueryPlan.buildBushyJoinTreeBranches(env.acum, callback);
    });
};

QueryPlan.buildBushyJoinTreeBranches = function(bindingsList, callback) {
    var that = this;
    if(bindingsList.length == 1){
        callback(true, bindingsList[0]);
    } else {
        var pairs = Utils.partition(bindingsList,2);
        var acum = [];
        for(var i=0; i<pairs.length; i++) {
            var pair = pairs[i];
            var bindingsa = pair[0];
            var bindingsb = pair[1];
            var result =  QueryPlan.executeAndBindings(bindingsa, bindingsb);
            pairs.push(result);
        }
        QueryPlan.buildBushyJoinTreeBranches(acum, callback);
    }
};

QueryPlan.executeAndBindings = function(bindingsa, bindingsb) {
    if(bindingsa==null) {
        return bindingsb;
    } else if(bindingsb==null) {
        return bindingsa;
    } else {
        if(bindingsa==[] || bindingsb==[]) {
            return [];
        } else {
            if(QueryPlan.variablesIntersectionBindings(bindingsa[0],bindingsb[0]).length == 0) {
                return QueryPlan.crossProductBindings(bindingsa,bindingsb);
            } else {
                return QueryPlan.joinBindings(bindingsa,bindingsb);
            }
        }
    }
};

QueryPlan.executeAndBGP = function(bgpa, bgpb, queryEngine, queryEnv, callback) {
    if(bgpa==null) {
        QueryPlan.executeEmptyJoinBGP(bgpb, queryEngine, queryEnv, callback);
    } else if(bgpb==null) {
        QueryPlan.executeEmptyJoinBGP(bgpa, queryEngine, queryEnv, callback);
    } else {
        var joinVars = QueryPlan.variablesIntersectionBGP(bgpa,bgpb);
        if(joinVars.length === 0) {
            // range a, range b -> cartesian product
            QueryPlan.executeCrossProductBGP(joinVars, bgpa, bgpb, queryEngine, queryEnv, callback);
        } else {
            // join on intersection vars
            QueryPlan.executeJoinBGP(joinVars, bgpa, bgpb, queryEngine, queryEnv, callback);
        }
    }
};

QueryPlan.executeEmptyJoinBGP = function(bgp, queryEngine, queryEnv, callback) {
    queryEngine.rangeQuery(bgp, queryEnv, function(success, results){
        if(success) {
            var bindings = QueryPlan.buildBindingsFromRange(results, bgp);
            callback(true, bindings);
        } else {
            callback(false, results);
        }
    });
};

QueryPlan.executeJoinBGP = function(joinVars, bgpa, bgpb, queryEngine, queryEnv, callback) {
    queryEngine.rangeQuery(bgpa, queryEnv, function(success, resultsa){
        if(success) {
            var bindingsa = QueryPlan.buildBindingsFromRange(resultsa, bgpa);
            queryEngine.rangeQuery(bgpb, queryEnv, function(success, resultsb){
                if(success) {
                    var bindingsb = QueryPlan.buildBindingsFromRange(resultsb, bgpb);
                    var bindings = QueryPlan.joinBindings(bindingsa, bindingsb);
                    callback(true, bindings);
                } else {
                    callback(false, results);
                }
            });
        } else {
            callback(false, results);
        }
    });
};

QueryPlan.executeCrossProductBGP = function(joinVars, bgpa, bgpb, queryEngine, queryEnv, callback) {
    queryEngine.rangeQuery(bgpa, queryEnv, function(success, resultsa){
        if(success) {
            var bindingsa = QueryPlan.buildBindingsFromRange(resultsa, bgpa);
            queryEngine.rangeQuery(bgpb, queryEnv, function(success, resultsb){
                if(success) {
                    var bindingsb = QueryPlan.buildBindingsFromRange(resultsb, bgpb);
                    var bindings = QueryPlan.crossProductBindings(bindingsa, bindingsb);
                    callback(true, bindings);
                } else {
                    callback(false, results);
                }
            });
        } else {
            callback(false, results);
        }
    });
};

QueryPlan.buildBindingsFromRange = function(results, bgp) {
    var variables = QueryPlan.variablesInBGP(bgp);
    var bindings = {};

    var components =  bgp.value||bgp;
    var bindings = {};
    for(comp in components) {
        if(components[comp] && components[comp].token === "var") {
            bindings[comp] = components[comp].value;
        }
    }

    var resultsBindings =[];

    for(var i=0; i<results.length; i++) {
        var binding = {};
        var result  = results[i];
        for(var comp in bindings) {
            var value = result[comp];
            binding[bindings[comp]] = value;
        }

        resultsBindings.push(binding);
    }

    return resultsBindings;
};

QueryPlan.variablesIntersectionBindings = function(bindingsa, bindingsb) {
    var ia = 0;
    var ib = 0;
    var varsa = [];
    var varsb = [];

    for(var variable in bindingsa) {
        varsa.push(variable);
    }

    for(var variable in bindingsb) {
        varsb.push(variable);
    }
    varsa.sort();
    varsb.sort();


    var intersection = [];

    while(ia<varsa.length && ib<varsb.length) {
        if(varsa[ia] === vars[ib]) {
            intersection.push(varsa[ia]);
            ia++;
            ib++;
        } else if(varsa[ia] < varsb[ib]) {
            ia++;
        } else {
            ib++;
        }
    }

    return intersection;
};

QueryPlan.areCompatibleBindings = function(bindingsa, bindingsb) {
    for(var variable in bindingsa) {
        if(bindingsb[variable]!=null && (bindingsb[variable] != bindingsa[variable])) {
            return false;
        }
    }

    return true;
};


QueryPlan.mergeBindings = function(bindingsa, bindingsb) {
    var merged = {};
    for(var variable in bindingsa) {
        merged[variable] = bindingsa[variable];
    }

    for(var variable in bindingsb) {
        merged[variable] = bindingsb[variable];
    }

    return merged;
};


QueryPlan.joinBindings = function(bindingsa, bindingsb) {
    var result = [];

    for(var i=0; i< bindingsa.length; i++) {
        var bindinga = bindingsa[i];
        for(var j=0; j<bindingsb.length; j++) {
            var bindingb = bindingsb[j];
            if(QueryPlan.areCompatibleBindings(bindinga, bindingb)){
                result.push(QueryPlan.mergeBindings(bindinga, bindingb));
            }
        }
    }

    return result;
};

QueryPlan.crossProductBindings = function(bindingsa, bindingsb) {
    var result = [];

    for(var i=0; i< bindingsa; i++) {
        var bindinga = bindingsa[i];
        for(var j=0; j<bindingsb; j++) {
            var bindingb = bindingsb[j];
            result.push(QueryPlan.mergeBindings(bindinga, bindingb));
         }
    }

    return result;
};

QueryPlan.unionBindings = function(bindingsa, bindingsb) {
    return bindingsa.concat(bindingsb);
};
