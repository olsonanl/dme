var solr = require("solr-client");
var Deferred = require("promised-io/promise").defer;
var All= require("promised-io/promise").all;
var Sequence= require("promised-io/promise").seq;
var Query = require("rql/query").Query;
var LazyArray = require("promised-io/lazy-array").LazyArray;
var StoreBase=require("../Store").Store;
var util = require("util");
var defer = require("promised-io/promise").defer;
var when = require("promised-io/promise").when;
var declare = require("dojo-declare/declare");
var jsArray= require("rql/js-array")
var handlers = [
	["and", function(query, options){
		var parts=[]
		query.args.forEach(function(a){
			var p = walkQuery(a,options);
			if (p){
				parts.push(p);
			}
		});
		parts = parts.filter(function(p){
			return !!p;
		});
		return "(" + parts.join(" AND ") + ")"
	}],	

	["or", function(query, options){
		var parts=[]
		query.args.forEach(function(a){
			parts.push(walkQuery(a,options));
		});

		parts = parts.filter(function(p){
			return !!p;
		});
	
		return "(" + parts.join(" OR ") + ")";
	}],

	["eq", function(query, options){
		var parts = [query.args[0]]
		//console.log("eq query", query);
		//console.log("Checking for match: ", query.args[1]);
		parts.push(walkQuery(query.args[1],options));
		return parts.join(":");

//		return query.args.join(":");
	}],
	["ne", function(query, options){
		var parts = [query.args[0]]
		//console.log("eq query", query);
		//console.log("Checking for match: ", query.args[1]);
		parts.push(walkQuery(query.args[1],options));
		return "-" + parts.join(":");

//		return query.args.join(":");
	}],
	
	["exists", function(query, options){
		return "-" + query.args[0] + ":[* TO *]";
	}],

	["match", function(query, options){
		return query.args.join(":/")+"/";
	}],
	["ge", function(query, options){
		return query.args[0] + ":{" + query.args[1] + " TO *}";
	}],
	["gt", function(query, options){
		return query.args[0] + ":[" + query.args[1] + " TO *]";
	}],
	["le", function(query, options){
		return query.args[0] + ":{* TO " + query.args[1] + "}";
	}],
	["lt", function(query, options){
		return query.args[0] + ":[* TO " + query.args[1] + "]";
	}],

	["between", function(query, options){
		return query.args[0] + ":[" + queyr.args[1] + " TO " + query.args[2] + "]";
	}],

	["field", function(query, options){
		return "(_val_:" + query.args[0] + ")";
	}],

	["qf", function(query, options){
		if (!options.qf){options.qf=[]}
		options.qf.push(walkQuery(query.args[0],options));
	}],

	["fq", function(query, options){
		if (!options.fq){options.fq=[]}
		options.fq.push(walkQuery(query.args[0],options));
	}],

	["not", function(query, options){
		return "NOT " + walkQuery(query.args[0],options);
	}],

	["in", function(query, options){
		//console.log("IN ", query.args[0], query.args[1]);
		return "(" + query.args[0] + ":(" + query.args[1].join(" OR ") + "))";
	}],

	["keyword", function(query,options){
		return query.args[0];
	}],

	["query", function(query, options){
		var queries = query.args.slice(1);
		var q = queries.map(function(qp){
			console.log("qp: ", qp);
			return Query(qp).toString();
		});
		var modelId = query.args[0];
		if (!options.queries){
			options.queries=[];
		}

		//console.log("query(q): ", q);
		options.queries.push([modelId,q.join("&")]);
		return;
	}],

	["distinct", function(query, options){
		if (!options.distinct){
			options.distinct=[]
		}

		options.distinct.push(query.args);
	}],


	["facet", function(query, options){
		//var parts = ["facets=true"];
//		query.args[0].forEach(function(field){
//				parts.push("facet.field=" + field);
//		});
//		parts.push("sort=" + query.args[1]);
		if (!options.facets){
			options.facets=[];
		}	

		function existingFacetProps(tprop){
			for (i=0; i < options.facets.length; ++i){
				if (options.facets[i]['field'] == tprop){
					return true;
				}
			}
			return false;
		}
		query.args.forEach(function(facet){
			var facetProp = facet[0];
			var facetVal = facet[1];

			console.log("facet[1]: ", facetVal);
			if (facetProp == "sort"){
				var dir =  (facetVal.charAt(0)=="+")?"ASC":"DESC";
				facetVal = facetVal.substr(1) + " " + dir;
		
			}
			if (facetVal instanceof Array){
				facetVal = facetVal.join(",");
			}	
			var f = {field: facetProp,value: facetVal}
			console.log("f: ", f);
			options.facets.push(f);
		});
		if (!existingFacetProps('mincount')){
			options.facets.push({field: "mincount", value: 1});
		}
		if (!existingFacetProps('limit')){
			options.facets.push({field: "limit", value: 500});
		}
	}],

	["cursor", function(query,options){
		return;
		
	}],
	["values", function(query, options){
		/*
		if (query.args[1] && (typeof query.args[1]=='object')){
			var objs =query.args[1].map(function(item){
				if ((typeof query.args[0]=='object') && query.args[0].length>1){
					var obj=[];
					query.args[0].forEach(function(prop){
						obj.push(item[prop]);
					});
				}else{
					if (item[query.args[0]]){ return item[query.args[0]]; }
				}
			})
			return "(" + objs.join(",") + ")"
		}
		*/
		options.values = query.args[0];
		return;
	}],

	["select", function(query, options){
		//options.select=query.args[0]
		options.select=query.args[0];
	}],
	["sort", function(query, options){
		return;
	}],
	["limit", function(query, options){
		return;
	}],

	["debugPost", function(item){
		console.log(arguments);
		return item;
	},"post"]
]
Query.prototype.toSolr = function(SolrQuery,options){
	options = options || {};

	options.handlers = options.handlers || handlers;
	var known = options.handlers.map(function(h){
		return h[0];
	});

	var query = this.normalize({
		known: known
	});

	console.log("query: ", query);

	var processedQ = walkQuery(query.original, options);

	if (!processedQ||processedQ=="()"||processedQ=="(())"){ processedQ = "*:*" };
	console.log("processedQ: ", processedQ);

	if (options.qf){
		processedQ += "&qf="+options.qf;
	}
	var q = SolrQuery.q(processedQ||"*:*") ;

	if (options.fq){
		options.fq.forEach(function(fq){
			q.set("fq=" + fq);
			//q.fq(fq);
		});
	}

	if (query.select){
		q.set("fl=" + query.select.join(","));
	}

	console.log("SolrQuery: ", q);
	
	if (query && query.sortObj){
		var so = {}
		for (prop in query.sortObj){
			so[prop] = (query.sortObj[prop]>0)?"asc":"desc";
		}
		q.sort(so);
	}
	
	console.log("Query Limit: ", query.limit, "Infinite: "< query.limit!==Infinity);

	if (query && typeof query.limit != 'undefined' && query.limit!==Infinity){
		if (typeof query.limit=='number'){
			q.rows(query.limit);
		}else{
			q.rows(query.limit[0]);
		}
	}else{
		q.rows(99999999);
	}

	if (query && (query.skip||(query.limit && query.limit[1]))){
		q.start(query.skip||query.limit[1])
	}

	if (options.facets){
		options.facets.forEach(function(f){
			q.parameters.push("facet=true");
			console.log("Param: ", "facet." + f.field + "=" + encodeURIComponent(f.value));
			q.parameters.push("facet." + f.field + "=" + encodeURIComponent(f.value));
//			q.facet(f);
		});
	}	
	if (options.bf){
		options.bf.forEach(function(bf){
		//	q.bf(bf);
			q.parameters.push('_query_:"' + bf + '"');
		});
	}
	
	return q;
}

var walkQuery=function(query,options){
	//console.log("Query: ",query);
	var handler;
		
	if (options.handlers.some(function(h){
		if (h&&h[0]==query.name){
			//console.log("found Handler: ", h[0]);
			handler=h;
			return true;
		}
	})){

		if (handler[2] && handler[2]=="post"){
			//console.log("Adding POST Handler: ", handler[0]);
			if (!options.post){
				options.post=[];
			}
			options.post.push(handler);
			return;
		}else{
			return handler[1](query, options);
		}
	} 

//	throw Error("Unknown Query Operator: " + query.name);
	//console.log("wq :", query);
	return query;

}

var Store = exports.Store = declare([StoreBase], {
	authConfigProperty: "solr",
	primaryKey: "id",
	init: function(){
		if (!this.options.auth) { console.log("SOLR Auth Information Not Found"); }	

		this.client= solr.createClient(this.options.auth.host,this.options.auth.port,this.id, this.options.auth.path);

		if (this.options && this.options.queryHandlers){
			this._handlers = this.options.queryHandlers.concat(handlers);
		}

	},
	query: function(query, opts){
//		console.log("Store Options: ", this.options);
		var _self=this;
		console.log("SOLR QUERY: ", query);
		q = (!query || typeof query == 'string')?Query(query):query;
		if (!q.toSolr) { q.toSolr = Query.prototype.toSolr; }
		var squery = q.toSolr(_self.client.createQuery());

		var searchDef = new defer();
		_self.client.search(squery, function(err, obj){
			if (err){
				console.log("SOLR Error Response: ", err);
				return searchDef.reject(err);
			}else{
				//console.log("obj: ", obj);
				if (obj && obj.response) {
					var responseItems = obj.response.docs;
					searchDef.resolve(obj.response);	
				}else{
					searchDef.reject(Error("Invalid Response Object"));
				}
			}
		});

		return when(searchDef,function(responseObj){
			return _self.postProcessQuery(responseObj.docs, responseObj, q);	
		});
	},

	postProcessQuery: function(items, responseObject, query){
//		console.log("POST Process Items: ", items);
//		console.log("POST Process Query: ", query);
		var q="";
		if (query.cache.values){
			var fields=(typeof query.cache.values=='string')?query.cache.values.split(','):query.cache.values;
			items = items.map(function(item){
				var obj = []
				Object.keys(item).filter(function(key){
					console.log("Checking for ", key);
					return fields.indexOf(key)>=0;
				}).forEach(function(key){
					console.log("Adding to item array: ", key, item[key]);
					obj.push(item[key]);
				});
				if (obj.length==1){
					console.log("obj: ", obj[0]);
					return obj[0];
				}
				console.log("obj: ", obj);
				return obj;
				
			});
		}

		return items;
	},

	get: function(id, opts){
			var def = new Deferred();
			var _self = this;	
			console.log("GET: ", id, opts);	
			var pk = this.options.primaryKey||this.options.primaryKey;

			if (!pk.map){
				pk=[pk];
			}

			var qs = pk.map(function(k){
				return "eq(" + k + "," + id + ")";
			}).join(",");

			
			//console.log("this.id: ", this);
			qs = "or(" + qs + ")&limit(1)";
			//console.log("qs: ", qs);
			var q = Query(qs).toSolr(_self.client.createQuery(),{handlers:this._handlers});

			_self.client.search(q, function(err, obj){
				if (err){
					def.reject(err);
				}else{
					if (obj && obj.response && obj.response.docs){
						return def.resolve(obj.response.docs[0]);
					}
					def.reject()
				}
			});
			return def.promise;
	}
});
	

