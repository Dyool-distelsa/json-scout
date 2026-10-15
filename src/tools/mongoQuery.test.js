import { describe, it, expect } from 'vitest';
import { isMongoQuery, mongoFind } from './mongoQuery.js';

const people = [
  { _id: 1, name: 'Ana', age: 31, city: 'Lima', tags: ['a', 'b'], address: { zip: '15001' } },
  { _id: 2, name: 'Beto', age: 25, city: 'Quito', tags: ['b'], address: { zip: '17001' } },
  { _id: 3, name: 'Carla', age: 40, city: 'lima', tags: [], scores: [{ v: 5 }, { v: 9 }] },
];
const names = (expr, data = people) => mongoFind(data, expr).results.map((r) => r.value.name);

describe('isMongoQuery', () => {
  it('tells Mongo filters from JSONPath', () => {
    expect(isMongoQuery('{ age: 1 }')).toBe(true);
    expect(isMongoQuery('db.users.find({})')).toBe(true);
    expect(isMongoQuery('find({})')).toBe(true);
    expect(isMongoQuery('$..name')).toBe(false);
    expect(isMongoQuery('author')).toBe(false);
  });
});

describe('mongoFind', () => {
  it('matches equality and comparison operators with relaxed syntax', () => {
    expect(names('{}')).toEqual(['Ana', 'Beto', 'Carla']);
    expect(names("{ city: 'Lima' }")).toEqual(['Ana']);
    expect(names('{ age: { $gt: 30 } }')).toEqual(['Ana', 'Carla']);
    expect(names('{ age: { $gte: 25, $lt: 40 } }')).toEqual(['Ana', 'Beto']);
    expect(names('{ age: { $ne: 25 } }')).toEqual(['Ana', 'Carla']);
    expect(names('{ name: { $in: ["Ana", "Carla"] } }')).toEqual(['Ana', 'Carla']);
    expect(names('{ name: { $nin: ["Ana"] } }')).toEqual(['Beto', 'Carla']);
  });

  it('supports regex, dotted paths, $exists and arrays like MongoDB', () => {
    expect(names('{ city: /^lima$/i }')).toEqual(['Ana', 'Carla']);
    expect(names('{ city: { $regex: "^l", $options: "i" } }')).toEqual(['Ana', 'Carla']);
    expect(names('{ "address.zip": "17001" }')).toEqual(['Beto']);
    expect(names('{ address: { $exists: false } }')).toEqual(['Carla']);
    expect(names('{ tags: "b" }')).toEqual(['Ana', 'Beto']);
    expect(names('{ tags: { $size: 0 } }')).toEqual(['Carla']);
    expect(names('{ tags: { $all: ["a", "b"] } }')).toEqual(['Ana']);
    expect(names('{ scores: { $elemMatch: { v: { $gt: 8 } } } }')).toEqual(['Carla']);
    expect(names('{ "scores.v": 5 }')).toEqual(['Carla']);
  });

  it('supports $or, $and, $nor and $not', () => {
    expect(names('{ $or: [{ age: 25 }, { city: "lima" }] }')).toEqual(['Beto', 'Carla']);
    expect(names('{ $and: [{ age: { $gt: 20 } }, { age: { $lt: 35 } }] }')).toEqual(['Ana', 'Beto']);
    expect(names('{ $nor: [{ age: 25 }] }')).toEqual(['Ana', 'Carla']);
    expect(names('{ age: { $not: { $gt: 30 } } }')).toEqual(['Beto']);
  });

  it('applies projection, sort, skip, limit and count', () => {
    expect(mongoFind(people, '{ age: { $gt: 30 } }, { name: 1, _id: 0 }').results.map((r) => r.value)).toEqual([
      { name: 'Ana' },
      { name: 'Carla' },
    ]);
    expect(mongoFind(people, '{}, { tags: 0, address: 0, scores: 0 }').results[0].value).toEqual({
      _id: 1,
      name: 'Ana',
      age: 31,
      city: 'Lima',
    });
    expect(names('{}.sort({ age: -1 })')).toEqual(['Carla', 'Ana', 'Beto']);
    expect(names('db.people.find({}).sort({ age: 1 }).skip(1).limit(1)')).toEqual(['Ana']);
    const counted = mongoFind(people, 'find({ age: { $gt: 20 } }).count()');
    expect(counted.results[0].value).toBe(3);
  });

  it('searches every object at any depth when the root is not an array', () => {
    const data = { store: { items: people, owner: { name: 'Dora', age: 50 } } };
    const found = mongoFind(data, '{ age: { $gte: 40 } }').results;
    expect(found.map((r) => r.value.name)).toEqual(['Carla', 'Dora']);
    expect(found[0].path).toBe('$.store.items[2]');
  });

  it('reports malformed queries and unknown operators', () => {
    expect(() => mongoFind(people, '{ age: ')).toThrow(/end of query/);
    expect(() => mongoFind(people, '{ age: { $near: 1 } }')).toThrow(/Unsupported operator/);
    expect(() => mongoFind(people, '{}.explain()')).toThrow(/Unsupported method/);
  });
});
