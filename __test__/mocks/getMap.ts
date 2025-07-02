// __test__/mocks/getMap.ts

interface GetMapParams {
  lat: number;
  lng: number;
}

interface GetMapResult {
  mapUrl: string;
}

const getMap = async (params: GetMapParams): Promise<GetMapResult> => {
  return {
    mapUrl: `https://maps.example.com/?lat=${params.lat}&lng=${params.lng}`,
  };
};

export default getMap;
