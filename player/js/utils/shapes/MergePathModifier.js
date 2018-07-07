function MergePathModifier(){
}
extendPrototype([ShapeModifier], MergePathModifier);

MergePathModifier.prototype.initModifierProperties = function(elem, data) {
	this.mode = data.mm;
	switch(data.mm) {
		case 2:
			this.mode = Module.PathOp.UNION;
			break;
		case 3:
			this.mode = Module.PathOp.DIFFERENCE;
			//merge_mode = Module.PathOp.REVERSE_DIFFERENCE;
			break;
		case 4:
			this.mode = Module.PathOp.INTERSECT;
			break;
		case 5:
			this.mode = Module.PathOp.XOR;
			break;
		default:
			this.mode = 'none';
	}
    this.getValue = this.processKeys;
};

MergePathModifier.prototype.transformPoint = function(point, transformers) {
	var i, len = transformers.length, matrix;
	for(i = 0; i < len; i += 1) {
		matrix = transformers[i].mProps.v;
		point = matrix.applyToPointArray(point[0], point[1], 0);
	}
	return point;
}

MergePathModifier.prototype.addPathToCommands = function(path, transformers, commands) {
	var i, len = path._length;
	var pt1, pt2, pt3;
	pt1 = this.transformPoint(path.v[0], transformers);
	commands.push([Module.MOVE_VERB, pt1[0], pt1[1]]);
	for(i = 0; i < len - 1; i += 1) {
		pt1 = this.transformPoint(path.o[i], transformers);
		pt2 = this.transformPoint(path.i[i + 1], transformers);
		pt3 = this.transformPoint(path.v[i + 1], transformers);
		commands.push([Module.CUBIC_VERB, pt1[0], pt1[1], pt2[0], pt2[1], pt3[0], pt3[1]]);
	}
	if(path.c) {
		pt1 = this.transformPoint(path.o[len - 1], transformers);
		pt2 = this.transformPoint(path.i[0], transformers);
		pt3 = this.transformPoint(path.v[0], transformers);
		commands.push([Module.CUBIC_VERB, pt1[0], pt1[1], pt2[0], pt2[1], pt3[0], pt3[1]]);
	}
}

MergePathModifier.prototype.floatTypedArrayFrom2D = function(arr) {
	// expects 2d array where index 0 is verb and index 1-n are args
	let len = 0;
	for (cmd of arr) {
	  len += cmd.length;
	}

	const ta = new Float32Array(len);
	let i = 0;
	for (cmd of arr) {
	  for (c of cmd) {
	    ta[i] = c;
	    i++;
	  }
	}

	retVal = Module._malloc(ta.length * ta.BYTES_PER_ELEMENT);
	Module.HEAPF32.set(ta, retVal / ta.BYTES_PER_ELEMENT);
	return [retVal, len];
}

MergePathModifier.prototype.SkPathFromCmdTyped = function(cmdArr) {
	let [cmd, len] = this.floatTypedArrayFrom2D(cmdArr);
	let path = Module.SkPathFromCmdTyped(cmd, len);
	Module._free(cmd);
	return path;
}

MergePathModifier.prototype.addShapeToCommands = function(shape, transformers, commands) {
	var i, len = shape.paths._length;
	for(i = 0; i < len; i += 1) {
		this.addPathToCommands(shape.paths.shapes[i], transformers, commands);
	}
}

MergePathModifier.prototype.processShapes = function(_isFirstFrame) {
	var commands = [];
	var i = 0, len = this.shapes.length;
	var shapeData, shape, skPath;
	var merge_mode = this.mode;
	var skPath;
	var builder = new Module.SkOpBuilder();
	var current_shape_merge_mode;

	var hasNewShapes = false;
	while(i < len) {
		if(this.shapes[i].shape._mdf) {
			hasNewShapes = true;
			break;
		}
		i += 1;
	}

	if(!hasNewShapes && !_isFirstFrame) {
		return;
	}

	for(i = len - 1; i >= 0; i -= 1) {
		shapeData = this.shapes[i];
		shape = shapeData.shape;
		this.addShapeToCommands(shape, shapeData.data.transformers, commands);
		if(merge_mode !== 'none') {
			if(i === len - 1 && (merge_mode === Module.PathOp.DIFFERENCE || merge_mode === Module.PathOp.REVERSE_DIFFERENCE || merge_mode === Module.PathOp.INTERSECT)) {
				current_shape_merge_mode = Module.PathOp.UNION;
			} else {
				current_shape_merge_mode = merge_mode;
			}
			builder.add(this.SkPathFromCmdTyped(commands), current_shape_merge_mode);
			commands.length = 0;
		}
		if(i > 0) {
            shapeData.shape._mdf = true;
            shapeData.shape.paths = shapeData.localShapeCollection;
		} else {
			shapeData.data.lvl = 0;
		}
	}
	if(merge_mode === 'none') {
    	skPath = this.SkPathFromCmdTyped(commands);
	} else {
    	skPath = Module.ResolveBuilder(builder);
	}

	shapeData = this.shapes[0];
	var localShapeCollection = shapeData.localShapeCollection;
    localShapeCollection.releaseShapes();
    var verbs = [];
  	var args = [];
  	Module.SkPathToVerbsArgsArray(skPath, verbs, args);
  	var i, len = verbs.length;
  	var new_path;
  	var args_index = 0, node_index = 0;
  	for(i = 0; i < len; i += 1) {
  		if(verbs[i] === Module.MOVE_VERB) {
  			if(new_path) {
  				localShapeCollection.addShape(new_path);
  			}
  			node_index = 0;
			new_path = shape_pool.newElement();
			new_path.setXYAt(args[args_index],args[args_index + 1],'v',node_index, false);
			new_path.setXYAt(args[args_index],args[args_index + 1],'i',node_index, false);
			args_index += 2;
			node_index += 1;
  		} else if(verbs[i] === Module.LINE_VERB) {
			new_path.setXYAt(args[args_index],args[args_index + 1],'v',node_index, false);
			new_path.setXYAt(args[args_index - 2],args[args_index - 1], 'o',node_index - 1, false);
			new_path.setXYAt(args[args_index],args[args_index + 1], 'i',node_index, false);
			args_index += 2;
			node_index += 1;
  		} else if(verbs[i] === Module.CUBIC_VERB) {
			new_path.setXYAt(args[args_index + 4],args[args_index + 5],'v',node_index, false);
			new_path.setXYAt(args[args_index],args[args_index + 1], 'o',node_index - 1, false);
			new_path.setXYAt(args[args_index + 2],args[args_index + 3], 'i',node_index, false);
			args_index += 6;
			node_index += 1;
  		} else if(verbs[i] === Module.CLOSE_VERB) {
			new_path.c = true;
			new_path.setXYAt(args[args_index - 2],args[args_index - 1],'o',node_index - 1, false);
			node_index += 1;
  		}
  	}
	if(new_path) {
		localShapeCollection.addShape(new_path);
	}
  	shapeData.shape._mdf = true;
    shapeData.shape.paths = shapeData.localShapeCollection;
}


ShapeModifiers.registerModifier('mm', MergePathModifier);