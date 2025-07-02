// __test__/mocks/geocoding.ts

interface GeocodingParams {
  location: string;
}

interface GeocodingResult {
  lat: number;
  lng: number;
}

const geocoding = async (params: GeocodingParams): Promise<GeocodingResult> => {
  // モックデータを返す
  const mockData: { [key: string]: GeocodingResult } = {
    "東京": { lat: 35.6895, lng: 139.6917 },
    "ニューヨーク": { lat: 40.7128, lng: -74.0060 },
    "ロンドン": { lat: 51.5074, lng: -0.1278 },
  };

  return mockData[params.location] || { lat: 0, lng: 0 };
};

export default geocoding;
